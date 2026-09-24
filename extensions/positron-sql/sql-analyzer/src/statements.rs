/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

//! Splitting a document into the SQL statements it contains.
//!
//! The tokenizer already knows which parts of a document cannot hold a statement separator --
//! comments, string literals, quoted identifiers, dollar quoted bodies -- so splitting its token
//! stream on semicolons is enough, and is dialect aware for free.
//!
//! Statements are split so that each one is parsed on its own: the parser stops at the first
//! statement it cannot parse, so parsing the document as a whole would hide every error after the
//! first one.
//!
//! # Closing what the author did not
//!
//! Tokenizing is the one failure that is not confined to the statement it happens in. A quote or a
//! comment that never closes swallows every character after it, so a single stray `'` on line two
//! takes the diagnostics, the statement ranges and the completions of a two hundred line file with
//! it -- and it is reached by typing one character, which is not an unusual thing for a person
//! editing SQL to do.
//!
//! So a construct that never closes is closed here, and the document is tokenized again. The
//! failure is still reported, at the construct rather than at the whole rest of the file; what
//! changes is that the text below it is still analyzed. See [`closer`] for where each kind of
//! delimiter is taken to end, and why the two answers differ.

use std::borrow::Cow;

use sqlparser::dialect::Dialect;
use sqlparser::tokenizer::{Location, Token, TokenWithSpan, Tokenizer, Whitespace};

use crate::text::TextIndex;

/// One statement of a document: its tokens, and its extent as UTF-16 offsets.
pub struct Statement {
    /// The statement's significant tokens, excluding whitespace, comments and its terminating
    /// semicolon. Their spans are absolute in the document, so anything derived from them needs
    /// no offset arithmetic.
    pub tokens: Vec<TokenWithSpan>,
    /// Offset of the statement's first token.
    pub start: u32,
    /// Offset just past the statement's last character, including its semicolon.
    pub end: u32,
    /// Whether the statement was closed by a semicolon, as opposed to running to end of file.
    pub terminated: bool,
    /// Whether the statement holds a construct the tokenizer had to be helped to close. Its tokens
    /// therefore include text the author did not write, so what the parser makes of them is not
    /// something to report.
    pub repaired: bool,
}

/// What tokenizing a document produced: its statements, and everywhere it needed help.
pub struct Tokenized {
    pub statements: Vec<Statement>,
    /// Every construct that never closed, in the order tokenizing reached them.
    pub errors: Vec<TokenizeError>,
}

pub struct TokenizeError {
    pub message: String,
    /// Offset of the construct that never closed.
    pub start: u32,
    /// Offset just past where the construct was taken to end.
    pub end: u32,
    /// Whether closing it let tokenizing carry on. When it did not, the statements stop here and
    /// the rest of the document was never seen.
    pub repaired: bool,
}

fn is_significant(token: &Token) -> bool {
    !matches!(token, Token::Whitespace(_) | Token::EOF)
}

/// Whether a whitespace token is a comment, which the tokenizer models as whitespace.
fn is_comment(token: &Token) -> bool {
    matches!(
        token,
        Token::Whitespace(Whitespace::SingleLineComment { .. } | Whitespace::MultiLineComment(_))
    )
}

/// How many constructs a document will have closed for it before the analyzer stops trying.
///
/// A bound rather than a loop to exhaustion: each closure is a guess about what the author meant,
/// and a document needing more than a handful is one where the guesses have stopped being worth
/// making. What is past the last one is reported the way it was before any of this: swallowed.
const REPAIRS: usize = 8;

/// Tokenizes a document and splits it into statements.
///
/// A run holding no significant tokens yields no statement, so a document of only comments and
/// whitespace produces none, as do the empty runs left by a stray or trailing semicolon.
pub fn split(text: &str, dialect: &dyn Dialect, index: &TextIndex) -> Tokenized {
    let (tokens, errors) = tokenize(text, dialect, index);

    let mut statements: Vec<Statement> = Vec::new();
    let mut current: Vec<TokenWithSpan> = Vec::new();
    // Offset just past the last significant token or comment, which is where an unterminated
    // final statement ends. Tracked as it goes so a trailing comment is not swallowed into the
    // statement above it.
    let mut last_end: u32 = 0;

    for token in tokens {
        if matches!(token.token, Token::SemiColon) {
            let end = index.span(token.span).map(|(_, end)| end).unwrap_or(last_end);
            flush(&mut statements, &mut current, end, true, index);
            last_end = end;
            continue;
        }
        if let Some((_, end)) = index.span(token.span) {
            if is_significant(&token.token) || is_comment(&token.token) {
                last_end = end;
            }
        }
        if is_significant(&token.token) {
            current.push(token);
        }
    }
    flush(&mut statements, &mut current, last_end, false, index);

    // Which statements hold text that was invented for them, which is what stops the parser's
    // opinion of that text being reported as though the author had written it.
    for statement in &mut statements {
        statement.repaired = errors.iter().any(|error| {
            error.repaired && error.start >= statement.start && error.start < statement.end
        });
    }

    Tokenized { statements, errors }
}

/// Tokenizes a document, closing anything that never closed, until it tokenizes or cannot be
/// helped.
///
/// Every closing delimiter goes at the end of a line or at the end of the document, which is what
/// makes the positions in the returned tokens still positions in the document the caller passed
/// in: inserting there leaves every line number, and every column on every later line, exactly
/// where it was. The [`TextIndex`] built from the original text therefore stays correct, and no
/// offset has to be adjusted for the text that was added.
fn tokenize(
    text: &str,
    dialect: &dyn Dialect,
    index: &TextIndex,
) -> (Vec<TokenWithSpan>, Vec<TokenizeError>) {
    // Borrowed until something has to be added to it, which is almost always: a document that
    // tokenizes is not copied, and this runs on the user's keystroke.
    let mut source = Cow::Borrowed(text);
    let mut tokens: Vec<TokenWithSpan> = Vec::new();
    let mut errors: Vec<TokenizeError> = Vec::new();
    let mut previous: Option<u32> = None;

    loop {
        tokens.clear();
        // Into a buffer rather than the plain `tokenize_with_location`, because the buffer keeps
        // the tokens that were scanned before the failure, and where scanning stopped is the only
        // pointer to the construct that never closed.
        let failure = Tokenizer::new(dialect, source.as_ref())
            .tokenize_with_location_into_buf(&mut tokens)
            .err();
        let Some(failure) = failure else { break };

        // Where the construct begins is read off the tokens rather than off the error, whose
        // location is the construct for a quote but the end of the document for a comment.
        let at = tokens.last().map(|token| token.span.end).unwrap_or(failure.location);
        let start = index.offset(at).unwrap_or(0);

        if previous == Some(start) {
            // The delimiter that was added did not close it -- an escaped quote at the end of a
            // line, say -- so this construct cannot be helped after all, and what was reported
            // for it becomes the report that it swallowed everything below.
            if let Some(last) = errors.last_mut() {
                last.repaired = false;
                last.end = index.end();
            }
            break;
        }
        previous = Some(start);

        let repair = (errors.len() < REPAIRS)
            .then(|| byte_at(&source, at))
            .flatten()
            .and_then(|byte| closer(&source[byte..]).map(|closer| (byte, closer)));

        let Some((byte, (closer, on_its_line))) = repair else {
            errors.push(TokenizeError {
                message: failure.message,
                start,
                end: index.end(),
                repaired: false,
            });
            break;
        };

        let line = (at.line.saturating_sub(1)) as usize;
        let end = if on_its_line { index.line_end(line) } else { index.end() };
        let insert = if on_its_line { line_end(&source, byte) } else { source.len() };
        source.to_mut().insert_str(insert, &closer);
        errors.push(TokenizeError {
            message: failure.message,
            start,
            end: end.max(start),
            repaired: true,
        });
    }

    (tokens, errors)
}

/// The text that would close the construct beginning at the front of `rest`, and whether it
/// belongs at the end of that construct's line rather than at the end of the document.
///
/// The two answers differ because the two kinds of construct are written differently. A quote that
/// closes nowhere in the rest of the document is far more likely to be a typo on one line than an
/// intent to quote every line below it, so it is closed on its line and what follows goes back to
/// being SQL. A block comment or a dollar quoted body is the other way round: both are written
/// across lines on purpose, so ending one at the first newline would resurrect text the author was
/// in the middle of commenting out and bury it in diagnostics. Those are closed at the end of the
/// document, which reports the same one problem but says nothing false about anything else.
///
/// `None` for anything this does not recognize, which leaves the document tokenized as far as the
/// failure and no further.
fn closer(rest: &str) -> Option<(String, bool)> {
    if rest.starts_with("/*") {
        return Some(("*/".to_string(), false));
    }
    if let Some(after) = rest.strip_prefix('$') {
        let tag: String = after
            .chars()
            .take_while(|character| character.is_alphanumeric() || *character == '_')
            .collect();
        let tag = format!("${tag}$");
        return rest.starts_with(&tag).then_some((tag, false));
    }
    // A literal may carry a prefix -- `N'`, `E'`, `X'`, `U&'` -- so the delimiter is the first
    // quote character rather than the first character. Only the first few are looked at: the
    // construct starts at its own delimiter, so a quote further along than that is a different
    // one, and reading it would close the wrong thing.
    rest.chars()
        .take(4)
        .find(|character| matches!(character, '\'' | '"' | '`'))
        .map(|quote| (quote.to_string(), true))
}

/// The byte index in `source` of a tokenizer location.
///
/// The repair pass works on the text rather than through the [`TextIndex`], which is built from
/// the original document and measures in the UTF-16 units the editor counts.
fn byte_at(source: &str, location: Location) -> Option<usize> {
    if location.line == 0 || location.column == 0 {
        return None;
    }
    let mut at = 0usize;
    for _ in 1..location.line {
        at += source[at..].find('\n')? + 1;
    }
    let column = (location.column - 1) as usize;
    Some(at + source[at..].chars().take(column).map(char::len_utf8).sum::<usize>())
}

/// The byte index of the end of the line a byte index falls on, its line break excluded.
fn line_end(source: &str, byte: usize) -> usize {
    let Some(newline) = source[byte..].find('\n') else {
        return source.len();
    };
    let end = byte + newline;
    // A carriage return belongs to the break rather than to the line, so a delimiter added at the
    // end of the line has to go before it.
    if source[..end].ends_with('\r') {
        end - 1
    } else {
        end
    }
}

fn flush(
    statements: &mut Vec<Statement>,
    current: &mut Vec<TokenWithSpan>,
    end: u32,
    terminated: bool,
    index: &TextIndex,
) {
    if current.is_empty() {
        return;
    }
    let start = current
        .first()
        .and_then(|token| index.span(token.span))
        .map(|(start, _)| start)
        .unwrap_or(0);
    statements.push(Statement {
        tokens: std::mem::take(current),
        start,
        end: end.max(start),
        terminated,
        // Filled in once the whole document is split, since a repair is located in the document
        // rather than in the statement it turns out to have landed in.
        repaired: false,
    });
}

/// The statement a UTF-16 offset falls in, or `None` if it falls between statements.
///
/// An offset inside the whitespace that follows a terminated statement belongs to no statement:
/// what the user types there starts a new one, so its completions should not be scoped to the
/// tables of the statement above. That includes the offset immediately past the semicolon, which
/// is why the test below is exclusive -- `end` is already past it. An offset past the end of an
/// *unterminated* final statement does belong to it, since that is what continuing to type it
/// looks like.
pub fn statement_at(statements: &[Statement], offset: u32) -> Option<&Statement> {
    let mut found: Option<&Statement> = None;
    for statement in statements {
        if statement.start > offset {
            break;
        }
        found = Some(statement);
    }
    let statement = found?;
    if offset < statement.end || !statement.terminated {
        Some(statement)
    } else {
        None
    }
}

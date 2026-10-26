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

use sqlparser::dialect::{Dialect, OracleDialect, SnowflakeDialect};
use sqlparser::keywords::Keyword;
use sqlparser::tokenizer::{Location, Token, TokenWithSpan, Tokenizer};

use crate::text::TextIndex;

/// One statement of a document: its tokens, and its extent as UTF-16 offsets.
pub struct Statement {
    /// The statement's significant SQL tokens, excluding whitespace, comments, its terminating
    /// semicolon and any ggsql `VISUALISE` part. Their spans are absolute in the document, so
    /// anything derived from them needs no offset arithmetic.
    pub tokens: Vec<TokenWithSpan>,
    /// Offset of the statement's first token.
    pub start: u32,
    /// Offset just past the statement's last character, including its semicolon.
    pub end: u32,
    /// Offset of the `VISUALISE` keyword that begins the statement's ggsql part, if it has one.
    /// See [`visualise_at`].
    pub visualise: Option<u32>,
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
    // Offset just past the last significant token, which is where an unterminated final statement
    // ends. Comments are not counted, so one after the last statement is not swallowed into it and
    // sent along with it to the console.
    let mut last_end: u32 = 0;

    let inside = block_bodies(&tokens, dialect);
    for (at, token) in tokens.into_iter().enumerate() {
        if matches!(token.token, Token::SemiColon) && !inside[at] {
            let end = index
                .span(token.span)
                .map(|(_, end)| end)
                .unwrap_or(last_end);
            flush(&mut statements, &mut current, end, true, index);
            last_end = end;
            continue;
        }
        if is_significant(&token.token) {
            if let Some((_, end)) = index.span(token.span) {
                last_end = end;
            }
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

/// How many times a block is taken to have been misread before the rest of the document is split
/// on its semicolons alone. See [`block_bodies`].
const MISREADS: usize = 8;

/// Which tokens sit inside a block of procedural SQL, by index: the semicolons that do not end the
/// statement they are in.
///
/// A trigger, procedure or function written in SQL rather than in a quoted body holds statements
/// of its own between `BEGIN` and `END` -- `CREATE TRIGGER t AFTER INSERT ON a BEGIN UPDATE b SET
/// n = 1; END;` -- and the semicolons that end those do not end the `CREATE`. So does an anonymous
/// block, `BEGIN ... END;` written on its own, as Oracle, T-SQL and Snowflake run them. Splitting
/// there would hand the parser half a block, report it as broken, and run half of it from the
/// editor.
///
/// Which `BEGIN`s and `END`s count is read off the keywords around them, by [`Blocks`], and is a
/// guess: the tokenizer does not know, and no dialect's parser here reads procedural SQL. A wrong
/// guess almost always leaves a block open at the end of the document -- a `BEGIN` counted that
/// has no `END`, or an `END` passed over -- and an open block takes every statement below it. So
/// a block still open at the end is taken to have been misread: the statement that opened it is
/// split on its semicolons like any other, and the reading starts again after its first one. A
/// misread then costs that one statement rather than the rest of the file, and a block that is
/// still being typed splits as it would have before it was a block.
fn block_bodies(tokens: &[TokenWithSpan], dialect: &dyn Dialect) -> Vec<bool> {
    let mut inside = vec![false; tokens.len()];
    let mut from = 0;
    for _ in 0..MISREADS {
        let Some(opened) = Blocks::new(tokens, dialect).read(from, &mut inside) else {
            return inside;
        };
        // From the statement that opened the block that never closed, nothing is inside a block
        // until its first semicolon, which ends it; the reading resumes after that.
        let Some(semicolon) =
            (opened..tokens.len()).find(|&at| matches!(tokens[at].token, Token::SemiColon))
        else {
            inside[opened..].fill(false);
            return inside;
        };
        inside[opened..=semicolon].fill(false);
        from = semicolon + 1;
    }
    inside[from..].fill(false);
    inside
}

/// What follows a `BEGIN` that starts a transaction rather than a block, by spelling: `BEGIN;`,
/// `BEGIN TRANSACTION`, T-SQL's `BEGIN TRAN` and `BEGIN DISTRIBUTED TRANSACTION`, SQLite's
/// `BEGIN IMMEDIATE`, PostgreSQL's `BEGIN ISOLATION LEVEL ...`, and T-SQL's `BEGIN DIALOG` and
/// `BEGIN CONVERSATION TIMER`, which are statements too. Anything else -- `BEGIN TRY`, `BEGIN NULL;`,
/// `BEGIN INSERT ...` -- opens a block.
const TRANSACTION_STARTS: &[&str] = &[
    "TRANSACTION",
    "TRAN",
    "WORK",
    "DISTRIBUTED",
    "DEFERRED",
    "IMMEDIATE",
    "EXCLUSIVE",
    "ISOLATION",
    "READ",
    "NOT",
    "DEFERRABLE",
    "DIALOG",
    "CONVERSATION",
];

/// The kinds of object a `CREATE` or `ALTER` can make whose body is a block. MySQL's `CREATE EVENT
/// ... DO BEGIN ... END` is one, `PROC` is T-SQL's abbreviation, and an Oracle package holds
/// routines.
const ROUTINE_KINDS: &[&str] = &[
    "TRIGGER",
    "PROCEDURE",
    "PROC",
    "FUNCTION",
    "EVENT",
    "PACKAGE",
];

/// The kinds of object that are not, and hold names a routine keyword could be spelled as: a table
/// with a column called `function`.
const OTHER_KINDS: &[&str] = &[
    "TABLE", "VIEW", "INDEX", "SEQUENCE", "SCHEMA", "DATABASE", "TYPE", "DOMAIN",
];

/// The words that end an `END` written for something other than a block: `END IF`, `END LOOP`,
/// `END WHILE`, `END REPEAT`, `END FOR`. Those close a construct that was never counted, so they
/// are passed over.
const OTHER_ENDS: &[&str] = &["IF", "LOOP", "WHILE", "REPEAT", "FOR"];

/// A reading of where the blocks of a document begin and end. See [`block_bodies`].
struct Blocks<'a> {
    tokens: &'a [TokenWithSpan],
    /// Whether `DECLARE` opens a block's declarations, as it does in PL/SQL and Snowflake
    /// Scripting. Elsewhere it is a statement of its own: `DECLARE @n INT;` in T-SQL, a cursor in
    /// PostgreSQL.
    declare_opens: bool,
    /// Whether a routine's `IS` or `AS` opens its declarations, as in PL/SQL:
    /// `CREATE PROCEDURE p IS n NUMBER; BEGIN ... END;`.
    is_opens: bool,
}

impl<'a> Blocks<'a> {
    fn new(tokens: &'a [TokenWithSpan], dialect: &dyn Dialect) -> Self {
        let oracle = dialect.is::<OracleDialect>();
        Self {
            tokens,
            declare_opens: oracle || dialect.is::<SnowflakeDialect>(),
            is_opens: oracle,
        }
    }

    /// Marks the tokens from `from` on that sit inside a block, and returns where the statement
    /// that opened a block left open at the end of the document starts, if one was.
    fn read(&self, from: usize, inside: &mut [bool]) -> Option<usize> {
        // The blocks open around the current token, innermost last. A level is `true` while it is
        // a block's declarations, which the block's own `BEGIN` continues rather than nesting in.
        let mut levels: Vec<bool> = Vec::new();
        // Where the current statement's first token is, once it has one.
        let mut statement: Option<usize> = None;
        // Whether the current statement makes something whose body is a block, which is what lets
        // a `BEGIN` in it open one.
        let mut routine = false;
        // Whether a PL/SQL routine has been named whose `IS` or `AS` is still to come.
        let mut header = false;
        let mut parentheses = 0usize;

        for (at, (token, inside)) in self
            .tokens
            .iter()
            .map(|token| &token.token)
            .zip(inside.iter_mut())
            .enumerate()
            .skip(from)
        {
            *inside = !levels.is_empty();
            if !is_significant(token) {
                continue;
            }
            match token {
                Token::SemiColon => {
                    header = false;
                    if levels.is_empty() {
                        statement = None;
                        routine = false;
                        parentheses = 0;
                    }
                    continue;
                }
                Token::LParen => parentheses += 1,
                Token::RParen => parentheses = parentheses.saturating_sub(1),
                _ => {}
            }

            let starts = statement.is_none();
            if starts {
                statement = Some(at);
            }
            let Token::Word(word) = token else { continue };
            if word.quote_style.is_some() {
                continue;
            }
            let spelled = |names: &[&str]| {
                names
                    .iter()
                    .any(|name| word.value.eq_ignore_ascii_case(name))
            };

            if starts {
                match word.keyword {
                    Keyword::CREATE | Keyword::ALTER => routine = self.makes_routine(at),
                    // An anonymous block, unless it is a transaction.
                    Keyword::BEGIN if !self.starts_transaction(at) => {
                        levels.push(false);
                        routine = true;
                        continue;
                    }
                    Keyword::DECLARE if self.declare_opens => {
                        levels.push(true);
                        routine = true;
                        continue;
                    }
                    _ => {}
                }
            }

            match word.keyword {
                _ if routine && self.is_opens && spelled(&["PROCEDURE", "FUNCTION", "PACKAGE"]) => {
                    header = true;
                }
                Keyword::IS | Keyword::AS if header && parentheses == 0 => {
                    header = false;
                    levels.push(true);
                }
                Keyword::DECLARE if routine && self.declare_opens && levels.is_empty() => {
                    levels.push(true);
                }
                Keyword::BEGIN if routine && !self.starts_transaction(at) => {
                    match levels.last_mut() {
                        Some(declarations @ true) => *declarations = false,
                        _ => levels.push(false),
                    }
                }
                Keyword::CASE if !levels.is_empty() => levels.push(false),
                Keyword::END if !levels.is_empty() && !self.ends_other(at) => {
                    levels.pop();
                }
                _ => {}
            }
        }

        if levels.is_empty() {
            None
        } else {
            statement
        }
    }

    /// The significant token after the one at `at`, and its index.
    fn next(&self, at: usize) -> Option<(usize, &'a Token)> {
        (at + 1..self.tokens.len())
            .map(|next| (next, &self.tokens[next].token))
            .find(|(_, token)| is_significant(token))
    }

    /// Whether the unquoted word at `at`, if it is one, is spelled as one of `names`.
    fn spelled(&self, at: Option<(usize, &Token)>, names: &[&str]) -> bool {
        matches!(at, Some((_, Token::Word(word))) if word.quote_style.is_none()
            && names.iter().any(|name| word.value.eq_ignore_ascii_case(name)))
    }

    /// Whether the `BEGIN` at `at` starts a transaction. See [`TRANSACTION_STARTS`].
    fn starts_transaction(&self, at: usize) -> bool {
        let next = self.next(at);
        matches!(next, None | Some((_, Token::SemiColon))) || self.spelled(next, TRANSACTION_STARTS)
    }

    /// Whether the `END` at `at` closes something other than a block: `END IF;`, `END LOOP name;`.
    ///
    /// Only when the statement ends there, after at most a label. T-SQL has none of these, and
    /// writes the statement after a block straight after its `END`, so `END` followed by `IF @b =
    /// 1` on the next line is a block's end and the start of an `IF`.
    fn ends_other(&self, at: usize) -> bool {
        let Some((word, _)) = self
            .next(at)
            .filter(|&next| self.spelled(Some(next), OTHER_ENDS))
        else {
            return false;
        };
        match self.next(word) {
            None | Some((_, Token::SemiColon)) => true,
            Some((label, Token::Word(_))) => {
                matches!(self.next(label), None | Some((_, Token::SemiColon)))
            }
            _ => false,
        }
    }

    /// Whether the `CREATE` or `ALTER` at `at` makes something whose body is a block.
    ///
    /// Decided by the kind of object it names, which comes before anything else the statement
    /// says: past modifiers such as `OR REPLACE`, `TEMPORARY` and MySQL's `DEFINER = user`, and
    /// before the object's name and anything in parentheses. A routine keyword further along is a
    /// name -- `CREATE TABLE schedule (function TEXT, begin DATE)` makes a table.
    fn makes_routine(&self, at: usize) -> bool {
        let mut at = at;
        // A header is a few words long; a statement that has named no kind by here is not one this
        // knows.
        for _ in 0..16 {
            let Some((next, token)) = self.next(at) else {
                return false;
            };
            match token {
                Token::Word(_) if self.spelled(Some((next, token)), ROUTINE_KINDS) => return true,
                Token::Word(_) if self.spelled(Some((next, token)), OTHER_KINDS) => return false,
                Token::Word(word) if word.keyword == Keyword::AS => return false,
                // `DEFINER = CURRENT_USER()` is the one pair of parentheses a header holds.
                Token::LParen if !matches!(self.next(next), Some((_, Token::RParen))) => {
                    return false;
                }
                Token::SemiColon => return false,
                _ => {}
            }
            at = next;
        }
        false
    }
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
        let at = tokens
            .last()
            .map(|token| token.span.end)
            .unwrap_or(failure.location);
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
        let end = if on_its_line {
            index.line_end(line)
        } else {
            index.end()
        };
        let insert = if on_its_line {
            line_end(&source, byte)
        } else {
            source.len()
        };
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
    // A bracketed identifier, in the dialects that write them: T-SQL, SQLite and Access. Checked
    // before the quotes, since `[it's` holds one within the characters looked at below, and
    // closing that would close nothing.
    if rest.starts_with('[') {
        return Some(("]".to_string(), true));
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
    Some(
        at + source[at..]
            .chars()
            .take(column)
            .map(char::len_utf8)
            .sum::<usize>(),
    )
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
    let mut tokens = std::mem::take(current);
    let visualise = visualise_at(&tokens).map(|at| {
        let offset = index
            .span(tokens[at].span)
            .map(|(offset, _)| offset)
            .unwrap_or(start);
        tokens.truncate(at);
        offset
    });
    statements.push(Statement {
        tokens,
        start,
        end: end.max(start),
        visualise,
        terminated,
        // Filled in once the whole document is split, since a repair is located in the document
        // rather than in the statement it turns out to have landed in.
        repaired: false,
    });
}

/// The index of the token that begins a statement's ggsql part, if it has one.
///
/// ggsql extends SQL with a visualization written after the query it plots: `SELECT ... VISUALISE
/// x, y DRAW point`, possibly with no query at all. What follows the keyword is not SQL in any
/// dialect, so it is left out of the tokens the parser sees rather than reported as an error in
/// every statement that has it. It stays inside the statement's extent, because running the
/// statement means sending both parts to ggsql together.
///
/// Either spelling, unquoted and outside any parentheses. ggsql's own grammar takes the keyword
/// anywhere, but inside parentheses it is an error there too, and that one is worth reporting.
fn visualise_at(tokens: &[TokenWithSpan]) -> Option<usize> {
    let mut depth = 0usize;
    tokens.iter().position(|token| match &token.token {
        Token::LParen => {
            depth += 1;
            false
        }
        Token::RParen => {
            depth = depth.saturating_sub(1);
            false
        }
        Token::Word(word) => {
            depth == 0
                && word.quote_style.is_none()
                && (word.value.eq_ignore_ascii_case("VISUALISE")
                    || word.value.eq_ignore_ascii_case("VISUALIZE"))
        }
        _ => false,
    })
}

impl Statement {
    /// Whether an offset falls in the statement's ggsql part, where nothing the SQL analysis knows
    /// applies.
    ///
    /// Exclusive of the keyword's first character, so a cursor at `|VISUALISE` is still at the end
    /// of the query and completes as SQL.
    pub fn in_visualise(&self, offset: u32) -> bool {
        self.visualise.is_some_and(|start| offset > start)
    }
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

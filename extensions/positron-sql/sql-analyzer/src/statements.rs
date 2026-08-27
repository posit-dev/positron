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

use sqlparser::dialect::Dialect;
use sqlparser::tokenizer::{Token, TokenWithSpan, Tokenizer, Whitespace};

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
}

/// What tokenizing a document produced: its statements, and the error that stopped it.
pub struct Tokenized {
    pub statements: Vec<Statement>,
    /// Where tokenizing gave up, if it did. Tokenizing is all or nothing for the text after the
    /// failure -- an unterminated string literal or block comment swallows the rest of the file
    /// -- so the statements are those that were complete before it.
    pub error: Option<TokenizeError>,
}

pub struct TokenizeError {
    pub message: String,
    /// Offset of the construct that never closed, or `None` if it could not be located.
    pub start: Option<u32>,
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

/// Tokenizes a document and splits it into statements.
///
/// A run holding no significant tokens yields no statement, so a document of only comments and
/// whitespace produces none, as do the empty runs left by a stray or trailing semicolon.
pub fn split(text: &str, dialect: &dyn Dialect, index: &TextIndex) -> Tokenized {
    let mut tokens: Vec<TokenWithSpan> = Vec::new();
    // Into a buffer rather than the plain `tokenize_with_location`, because the buffer keeps the
    // tokens that were scanned before the failure, and where scanning stopped is the only pointer
    // to the construct that never closed.
    let error = Tokenizer::new(dialect, text)
        .tokenize_with_location_into_buf(&mut tokens)
        .err();

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

    Tokenized {
        statements,
        error: error.map(|error| TokenizeError {
            message: error.message,
            start: index.offset(error.location),
        }),
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
    });
}

/// The statement a UTF-16 offset falls in, or `None` if it falls between statements.
///
/// An offset inside the whitespace that follows a terminated statement belongs to no statement:
/// what the user types there starts a new one, so its completions should not be scoped to the
/// tables of the statement above. An offset past the end of an *unterminated* final statement
/// does belong to it, since that is what continuing to type it looks like.
pub fn statement_at(statements: &[Statement], offset: u32) -> Option<&Statement> {
    let mut found: Option<&Statement> = None;
    for statement in statements {
        if statement.start > offset {
            break;
        }
        found = Some(statement);
    }
    let statement = found?;
    if offset <= statement.end || !statement.terminated {
        Some(statement)
    } else {
        None
    }
}

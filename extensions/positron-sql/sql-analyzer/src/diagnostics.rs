/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

//! Syntax diagnostics for a SQL document, and the reference analysis that rides along with them.
//!
//! Each statement is parsed on its own so that an error in one does not hide the statements after
//! it, which is what parsing the document as a whole would do. The parser reports the first
//! problem in a statement and stops, so a statement yields at most one syntax diagnostic -- which
//! is also what is wanted: past the first, errors in one statement are cascades of it, and every
//! extra squiggle is one the user has to read past to find the real problem.

use sqlparser::dialect::Dialect;
use sqlparser::parser::{Parser, ParserError};

use crate::scopes::{self, Analysis};
use crate::statements::{Statement, Tokenized};
use crate::text::TextIndex;

/// How deeply the parser will nest before giving up.
///
/// sqlparser's own guard, rather than the `recursive-protection` feature, which grows the stack
/// through a C shim that has no wasm implementation. The limit is what keeps pathological input
/// -- a thousand nested parentheses, which a generated query really can contain -- from
/// overflowing the wasm stack and trapping the whole module.
pub(crate) const RECURSION_LIMIT: usize = 50;

pub struct Diagnostic {
    pub start: u32,
    pub end: u32,
    pub message: String,
}

/// The result of parsing a document: what is wrong with it, and what it refers to.
pub struct Parsed {
    pub diagnostics: Vec<Diagnostic>,
    pub analysis: Analysis,
}

/// Parses every statement of an already tokenized document.
pub fn parse(tokenized: &Tokenized, dialect: &dyn Dialect, index: &TextIndex) -> Parsed {
    let mut diagnostics = Vec::new();
    let mut analysis = Analysis::default();

    for error in &tokenized.errors {
        let start = error.start.min(index.end());
        diagnostics.push(Diagnostic {
            start,
            end: error.end.min(index.end()).max(start),
            message: sentence(&error.message),
        });
    }

    // A construct that could not be closed truncates whatever statement it landed in, and since
    // tokenizing stops there that can only be the last statement collected. Parsing it would
    // report that it ends unexpectedly, which is true and useless: it ends where the tokenizer
    // gave up, and that is already the diagnostic above.
    let truncated = tokenized
        .errors
        .iter()
        .any(|error| !error.repaired)
        .then(|| tokenized.statements.len().saturating_sub(1));

    for (at, statement) in tokenized.statements.iter().enumerate() {
        if Some(at) == truncated {
            continue;
        }
        match parse_one(statement, dialect, index) {
            // Kept for a repaired statement as well as an intact one. The invented text is a
            // delimiter, so what it can add to the analysis is confined to the construct it
            // closed -- a quoted identifier that reads to the end of its line, say -- and that
            // construct already carries the diagnostic saying it never closed. The rest of the
            // statement is what the author wrote, and dropping its tables to avoid the one
            // artefact would cost the links and completions in every statement with a stray
            // quote in it.
            Ok(parsed) => merge(&mut analysis, scopes::analyze(&parsed, index)),
            // A statement the tokenizer had to close a construct for is being reported already,
            // and the parser is now reading a delimiter the author never wrote, so whatever it
            // objects to is an artefact of the repair rather than something to show anyone.
            Err(_) if statement.repaired => {}
            Err(diagnostic) => diagnostics.push(diagnostic),
        }
    }

    // Tokenize failures are found before any statement is parsed, so without this a stray quote
    // on the last line would be reported above a syntax error on the first.
    diagnostics.sort_by_key(|diagnostic| diagnostic.start);

    Parsed { diagnostics, analysis }
}

fn parse_one(
    statement: &Statement,
    dialect: &dyn Dialect,
    index: &TextIndex,
) -> Result<Vec<sqlparser::ast::Statement>, Diagnostic> {
    // The tokens carry their absolute spans in the document, so everything the parser produces
    // from them -- error positions, identifier spans -- is already in document coordinates.
    let parsed = Parser::new(dialect)
        .with_recursion_limit(RECURSION_LIMIT)
        .with_tokens_with_locations(statement.tokens.clone())
        .parse_statements();

    match parsed {
        Ok(parsed) => Ok(parsed),
        Err(error) => Err(diagnose(&error, statement, index)),
    }
}

/// Turns a parser error into the diagnostic shown under the squiggle.
fn diagnose(error: &ParserError, statement: &Statement, index: &TextIndex) -> Diagnostic {
    let message = match error {
        ParserError::RecursionLimitExceeded => {
            return Diagnostic {
                start: statement.start,
                end: statement.end,
                message: "This statement nests too deeply to parse.".to_string(),
            }
        }
        ParserError::TokenizerError(message) | ParserError::ParserError(message) => message.as_str(),
    };

    // The offending token, taken from the message rather than from the parser: sqlparser builds
    // the message from the token it rejected, whereas by the time the error is returned the
    // parser's own cursor has moved past it and points at whatever follows.
    let (start, end) = locate(message, statement, index)
        .unwrap_or((statement.start, statement.end));
    Diagnostic { start, end, message: sentence(strip_location(message)) }
}

/// The extent of the token a message blames, as offsets in the document.
///
/// Returns `None` when the message carries no position, which is how sqlparser reports an error
/// at end of input: there is no token to point at, and the caller squiggles the whole unfinished
/// statement instead.
fn locate(message: &str, statement: &Statement, index: &TextIndex) -> Option<(u32, u32)> {
    let at = message.rfind(" at Line: ")?;
    let (line, column) = parse_location(&message[at..])?;
    let start = index.offset(sqlparser::tokenizer::Location::new(line, column))?;

    // `found: <token>` names the text that was rejected, which is how wide the squiggle should
    // be. Counted in UTF-16 units, since that is what the offsets around it are measured in.
    let width = message[..at]
        .rfind("found: ")
        .map(|found| message[..at][found + "found: ".len()..].chars().map(char::len_utf16).sum::<usize>() as u32)
        .filter(|width| *width > 0)
        .unwrap_or(1);

    let start = start.clamp(statement.start, statement.end);
    Some((start, (start + width).min(statement.end)))
}

/// Reads the `` at Line: 3, Column: 7`` suffix sqlparser appends to a located message.
fn parse_location(suffix: &str) -> Option<(u64, u64)> {
    let rest = suffix.strip_prefix(" at Line: ")?;
    let (line, rest) = rest.split_once(", Column: ")?;
    Some((line.trim().parse().ok()?, rest.trim().parse().ok()?))
}

/// Drops the `` at Line: 3, Column: 7`` sqlparser appends to some messages.
///
/// The position is already the position of the squiggle, so repeating it in the text says nothing
/// and reads like debugging output.
fn strip_location(message: &str) -> &str {
    match message.rfind(" at Line: ") {
        Some(at) if parse_location(&message[at..]).is_some() => message[..at].trim_end(),
        _ => message,
    }
}

/// Ensures a message reads as a sentence, since these are shown to the user as prose.
fn sentence(message: &str) -> String {
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return "Could not parse this SQL.".to_string();
    }
    if trimmed.ends_with('.') || trimmed.ends_with('?') || trimmed.ends_with('!') {
        trimmed.to_string()
    } else {
        format!("{trimmed}.")
    }
}

/// Appends one statement's analysis to the document's, renumbering its scopes.
///
/// Every statement is analyzed on its own and numbers its scopes from zero, so the second
/// statement's scope 0 has to become the document's scope N before the two can share a list.
fn merge(into: &mut Analysis, from: Analysis) {
    let scope_offset = into.scopes.len() as u32;
    let table_offset = into.tables.len() as u32;

    for mut scope in from.scopes {
        scope.parent = scope.parent.map(|parent| parent + scope_offset);
        scope.tables = scope.tables.iter().map(|table| table + table_offset).collect();
        into.scopes.push(scope);
    }
    for mut table in from.tables {
        table.scope += scope_offset;
        into.tables.push(table);
    }
    for mut column in from.columns {
        column.scope += scope_offset;
        into.columns.push(column);
    }
}

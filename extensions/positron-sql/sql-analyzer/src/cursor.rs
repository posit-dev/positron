/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

//! What the statement under the cursor says the cursor can see, by parsing it with the hole filled
//! in.
//!
//! Completion is only ever asked about a statement halfway through being typed, and half typed SQL
//! does not parse: at `SELECT | FROM orders` there is no expression where one belongs, so
//! sqlparser returns an error and there is no tree at all -- no FROM clause to read, and nothing to
//! offer.
//!
//! So an identifier is written into the hole before the statement is parsed. `SELECT | FROM orders`
//! is parsed as `SELECT __positron_cursor__ FROM orders`, which does parse, and the tree it yields
//! is the tree of the statement the user is in the middle of writing. This is the trick IntelliJ
//! and rust-analyzer both use, for the same reason: an editor's parser is asked about incomplete
//! text far more often than about complete text, and a placeholder is much cheaper than a parser
//! that can recover.
//!
//! The marker earns its keep twice. It makes the statement parse, and -- because it comes back out
//! of the parser as a node with the cursor's own position -- it says *where in the tree* the cursor
//! ended up, which is the question [`crate::scopes`] can then answer properly. That is the whole
//! difference from [`crate::sources`], which reads the same tables off the tokens: a flat scan of
//! `WITH recent AS (SELECT id FROM orders) SELECT | FROM recent` finds `orders`, and offering its
//! columns is wrong, because the select the cursor is in cannot see them.
//!
//! When no attempt parses there is still [`crate::sources`] to fall back on, so the worst case is
//! the answer that was being given before.

use std::collections::HashSet;

use sqlparser::dialect::Dialect;
use sqlparser::keywords::Keyword;
use sqlparser::parser::Parser;
use sqlparser::tokenizer::{Span, Token, TokenWithSpan, Word};

use crate::diagnostics::RECURSION_LIMIT;
use crate::scopes::{self, Analysis};
use crate::sources::SourceRef;
use crate::statements::Statement;
use crate::text::TextIndex;

/// The identifier written into the hole the cursor is in.
///
/// Spelled so that it cannot collide with anything a person would type, since a real identifier of
/// the same name would be mistaken for the cursor. If one ever did, the cost is that completion is
/// scoped to the wrong part of a statement, not that anything breaks.
const MARKER: &str = "__positron_cursor__";

/// What the statement under the cursor can see from there.
pub struct AtCursor {
    /// The real tables in scope, nearest first. A table of an enclosing query is included: a
    /// correlated subquery may refer to one, so its columns belong in the list.
    pub sources: Vec<SourceRef>,
    /// The names the statement defines for itself and the cursor can refer to: CTEs, derived table
    /// aliases, and the names those are read under.
    pub locals: Vec<String>,
    /// Whether the cursor can see something whose columns cannot be known -- a CTE, a derived
    /// table, a table function. A column completed here may be one of those, so a caller that
    /// judges names must not judge them here.
    pub opaque: bool,
}

/// The tables and names in scope at an offset, or `None` if the statement could not be parsed even
/// with the hole filled in.
pub fn at(
    statement: &Statement,
    offset: u32,
    dialect: &dyn Dialect,
    index: &TextIndex,
) -> Option<AtCursor> {
    let (before, after) = split(&statement.tokens, offset, index);
    let marker = marker(offset, index);

    let whole: Vec<TokenWithSpan> =
        before.iter().chain(&marker).chain(after.iter()).cloned().collect();
    // Without the tail, for when the tail is what the statement cannot make sense of. Typing in
    // the middle of a statement usually leaves something ahead of the cursor that no longer fits
    // what is behind it, and the tables the cursor can see are nearly always behind it anyway.
    let prefix: Vec<TokenWithSpan> = before.iter().chain(&marker).cloned().collect();

    [whole, prefix].into_iter().find_map(|tokens| try_parse(close(tokens), dialect, index))
}

/// The marker as a token, positioned where the cursor is.
///
/// A real position rather than an empty span, because that is how it is found again: a node the
/// parser reports as coming from nowhere is skipped by [`crate::scopes`], which would leave the
/// marker in the tree and invisible in the analysis.
fn marker(offset: u32, index: &TextIndex) -> [TokenWithSpan; 1] {
    let at = index.location(offset);
    [TokenWithSpan {
        token: Token::Word(Word {
            value: MARKER.to_string(),
            quote_style: None,
            keyword: Keyword::NoKeyword,
        }),
        span: Span::new(at, at),
    }]
}

/// The tokens on either side of the cursor, with the word being typed dropped.
///
/// The token under the cursor is the word being completed, not a word the statement contains: at
/// `SELECT * FROM ord|` the user has typed three characters of a table name, and keeping them
/// would parse a statement about a table called `ord` rather than about the slot it sits in. The
/// marker takes its place.
fn split<'a>(
    tokens: &'a [TokenWithSpan],
    offset: u32,
    index: &TextIndex,
) -> (&'a [TokenWithSpan], &'a [TokenWithSpan]) {
    let mut cut = 0;
    let mut resume = tokens.len();

    for (at, token) in tokens.iter().enumerate() {
        let Some((start, end)) = index.span(token.span) else { continue };
        if end <= offset {
            cut = at + 1;
            continue;
        }
        // The first token the cursor has not run past. It either straddles the cursor, and is the
        // one being typed, or begins at or after it and is untouched.
        resume = if start < offset { at + 1 } else { at };
        break;
    }

    // A word ending exactly where the cursor is is also one being typed, since that is what the
    // cursor sits at the end of while it is being written.
    if let Some(last) = cut.checked_sub(1) {
        let typing = index
            .span(tokens[last].span)
            .map(|(start, end)| end == offset && start < offset)
            .unwrap_or(false);
        if typing && matches!(tokens[last].token, Token::Word(_)) {
            cut = last;
        }
    }

    (&tokens[..cut], &tokens[resume.max(cut)..])
}

/// Closes any parenthesis the cursor is still inside.
///
/// A subquery or a function call being typed is open by definition -- `SELECT * FROM (SELECT |`
/// -- and an unclosed one is the difference between a statement that parses and one that does
/// not, so the brackets the author has not reached yet are supplied.
fn close(mut tokens: Vec<TokenWithSpan>) -> Vec<TokenWithSpan> {
    let mut depth = 0i32;
    for token in &tokens {
        match token.token {
            Token::LParen => depth += 1,
            Token::RParen => depth -= 1,
            _ => {}
        }
    }
    for _ in 0..depth.max(0) {
        // No position: this is not in the document, and a node built out of it must not be
        // reported as though it were.
        tokens.push(TokenWithSpan { token: Token::RParen, span: Span::empty() });
    }
    tokens
}

fn try_parse(
    tokens: Vec<TokenWithSpan>,
    dialect: &dyn Dialect,
    index: &TextIndex,
) -> Option<AtCursor> {
    let parsed = Parser::new(dialect)
        .with_recursion_limit(RECURSION_LIMIT)
        .with_tokens_with_locations(tokens)
        .parse_statements()
        .ok()?;
    let analysis = scopes::analyze(&parsed, index);
    let scope = marker_scope(&analysis)?;
    Some(collect(&analysis, scope))
}

/// The scope the marker ended up in, or `None` if the parser dropped it.
///
/// Three places it can land, because three things can be written where a cursor sits: an
/// expression, the name of a table, and the alias of one -- `SELECT * FROM orders |` reads the
/// marker as what `orders` is being called.
fn marker_scope(analysis: &Analysis) -> Option<u32> {
    let column = analysis.columns.iter().find(|column| column.name == MARKER);
    if let Some(column) = column {
        return Some(column.scope);
    }
    analysis
        .tables
        .iter()
        .find(|table| table.name == MARKER || table.alias.as_deref() == Some(MARKER))
        .map(|table| table.scope)
}

/// Walks out from the cursor's scope, collecting what each level along the way can see.
fn collect(analysis: &Analysis, scope: u32) -> AtCursor {
    let mut found = AtCursor { sources: Vec::new(), locals: Vec::new(), opaque: false };
    // A select hands its tables up to the query around it, so walking out from a select reaches
    // the same reference twice; see `lift` in [`crate::scopes`].
    let mut seen: HashSet<u32> = HashSet::new();
    let mut named: HashSet<String> = HashSet::new();
    let mut at = Some(scope);

    // Scopes are numbered as they are opened, so a parent is always a lower number than its child
    // and the walk cannot loop. Bounded anyway: this runs in the extension host, where a hang is
    // the one failure the caller cannot recover from.
    for _ in 0..analysis.scopes.len() {
        let Some(id) = at else { break };
        let Some(entry) = analysis.scopes.get(id as usize) else { break };

        found.opaque |= entry.opaque;
        for local in &entry.locals {
            if local != MARKER && named.insert(local.to_lowercase()) {
                found.locals.push(local.clone());
            }
        }
        for at in &entry.tables {
            let Some(table) = analysis.tables.get(*at as usize) else { continue };
            if table.name == MARKER || !seen.insert(*at) {
                continue;
            }
            found.sources.push(SourceRef {
                name: table.name.clone(),
                schema: table.schema.clone(),
                catalog: table.catalog.clone(),
                // The marker is only ever read as an alias because the cursor sits where one would
                // go, which means the table has not been given one.
                alias: table.alias.clone().filter(|alias| alias != MARKER),
            });
        }

        at = entry.parent;
    }

    found
}

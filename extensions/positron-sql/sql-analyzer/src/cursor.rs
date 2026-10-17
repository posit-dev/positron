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
use crate::scopes::{self, Analysis, Local, LocalKind};
use crate::sources::SourceRef;
use crate::statements::Statement;
use crate::text::TextIndex;
use crate::tokens;

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
    /// The names the statement defines for itself and the cursor can refer to, nearest first.
    pub locals: Vec<Local>,
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
    // The word being typed is dropped, so the statement parsed is about the slot it sits in rather
    // than about a table called `ord`; the marker takes its place.
    let (before, after) = tokens::around(&statement.tokens, offset, index);
    let marker = marker(offset, index);

    let with_tail = |kept: usize| -> Vec<TokenWithSpan> {
        before.iter().chain(&marker).chain(&after[..kept]).cloned().collect()
    };

    // The whole statement first. Then with its last few tokens cut off, for a statement whose
    // unfinished part is past the cursor: `SELECT | FROM orders WHERE` does not parse, but its
    // FROM clause is what the select list reads from, and `SELECT | FROM orders` does. Then
    // without the tail at all, for when the tail is what the statement cannot make sense of --
    // typing in the middle of a statement usually leaves something ahead of the cursor that no
    // longer fits what is behind it, and the tables the cursor can see are then behind it.
    // Bounded, because each attempt is a parse on the user's keystroke.
    let trims = (1..=TAIL_TRIMS).take_while(|cut| *cut < after.len());
    std::iter::once(after.len())
        .chain(trims.map(|cut| after.len() - cut))
        .chain(std::iter::once(0))
        .find_map(|kept| try_parse(close(with_tail(kept)), dialect, index))
}

/// How many tokens may be cut from the end of a statement to make it parse. Enough for the
/// unfinished end of a clause -- `GROUP BY`, `ON a.id =`, `IN (` -- and no more.
const TAIL_TRIMS: usize = 4;

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
    let mut named: HashSet<(String, LocalKind)> = HashSet::new();

    // The scopes the walk will pass through. A table further out is only visible from here if it
    // was found in one of them: the tables a query holds were lifted into it from the selects
    // inside, and from one half of a `UNION` the other half's FROM clause cannot be seen.
    let mut path: HashSet<u32> = HashSet::new();
    let mut up = Some(scope);
    for _ in 0..analysis.scopes.len() {
        let Some(id) = up else { break };
        path.insert(id);
        up = analysis.scopes.get(id as usize).and_then(|entry| entry.parent);
    }

    let mut at = Some(scope);

    // Scopes are numbered as they are opened, so a parent is always a lower number than its child
    // and the walk cannot loop. Bounded anyway: this runs in the extension host, where a hang is
    // the one failure the caller cannot recover from.
    for _ in 0..analysis.scopes.len() {
        let Some(id) = at else { break };
        let Some(entry) = analysis.scopes.get(id as usize) else { break };

        // Whether the cursor's own select lifted tables into this level, which makes the others
        // lifted beside them a sibling's. Not otherwise: a subquery in a query's ORDER BY reaches
        // the query's tables the same way, and it may be correlated to them. The cursor's own
        // scope is exempt either way, since what was lifted into it is what its ORDER BY names.
        let beside = id != scope
            && entry.tables.iter().any(|at| {
                analysis.tables.get(*at as usize).is_some_and(|table| table.scope != id && path.contains(&table.scope))
            });

        found.opaque |= entry.opaque;
        // Deduplicated per kind rather than by name alone: a CTE read by its own name is both a
        // CTE the FROM clause can name again and a relation a column can be qualified by.
        for local in &entry.locals {
            if local.name != MARKER && named.insert((local.name.to_lowercase(), local.kind)) {
                found.locals.push(local.clone());
            }
        }
        for at in &entry.tables {
            let Some(table) = analysis.tables.get(*at as usize) else { continue };
            if table.name == MARKER || (beside && !path.contains(&table.scope)) || !seen.insert(*at) {
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

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

//! Reading the tables a statement names straight off its tokens, for completion.
//!
//! Completion has to work on text that does not parse, because the user is in the middle of
//! typing it, and sqlparser has no error recovery: one missing expression and there is no tree at
//! all, so no FROM clause to read and no columns to offer. Nothing about the question needs a
//! tree, though. Completion only wants to know which tables the statement mentions and what it
//! called them, and a FROM clause says that in its tokens.
//!
//! The tokenizer still does the hard part -- comments, string literals, quoted identifiers and
//! dollar quoted bodies are already tokens rather than text to be scanned past -- so what is left
//! is walking the token list for the keywords that introduce a table and reading the name after
//! each one.

use sqlparser::keywords::Keyword;
use sqlparser::tokenizer::{Token, TokenWithSpan, Word};

/// A table the statement names, with the alias it was given.
pub struct SourceRef {
    pub name: String,
    pub schema: Option<String>,
    pub catalog: Option<String>,
    pub alias: Option<String>,
}

/// The keywords a table name may follow.
fn introduces_table(keyword: Keyword) -> bool {
    matches!(keyword, Keyword::FROM | Keyword::JOIN | Keyword::INTO | Keyword::UPDATE)
}

/// The keywords that end a FROM clause, so a word after one of them is not read as a table.
fn ends_table_list(keyword: Keyword) -> bool {
    matches!(
        keyword,
        Keyword::WHERE
            | Keyword::GROUP
            | Keyword::ORDER
            | Keyword::HAVING
            | Keyword::LIMIT
            | Keyword::OFFSET
            | Keyword::UNION
            | Keyword::INTERSECT
            | Keyword::EXCEPT
            | Keyword::WINDOW
            | Keyword::QUALIFY
            | Keyword::FETCH
            | Keyword::SET
            | Keyword::VALUES
            | Keyword::RETURNING
            | Keyword::ON
            | Keyword::USING
            | Keyword::SELECT
            | Keyword::WITH
    )
}

/// The keywords that decorate a join without naming anything, and so are skipped over.
fn is_join_noise(keyword: Keyword) -> bool {
    matches!(
        keyword,
        Keyword::INNER
            | Keyword::LEFT
            | Keyword::RIGHT
            | Keyword::FULL
            | Keyword::CROSS
            | Keyword::OUTER
            | Keyword::NATURAL
            | Keyword::LATERAL
            | Keyword::JOIN
            | Keyword::AS
    )
}

fn word(token: &TokenWithSpan) -> Option<&Word> {
    match &token.token {
        Token::Word(word) => Some(word),
        _ => None,
    }
}

/// Whether a word can be read as a table name or an alias.
///
/// Deliberately not "is not a keyword". sqlparser keeps one keyword table for every dialect and
/// it holds over a thousand entries, so ordinary names -- `warehouse`, `value`, `source`, `year`
/// -- are keywords in it, and refusing to read them would lose the completions for exactly the
/// tables most likely to be named that way. What actually has to be excluded is the handful of
/// words that mean something structural right here, since those are the ones that would otherwise
/// be read as the name of a table that was never written.
fn can_be_name(word: &Word) -> bool {
    word.quote_style.is_some()
        || !(ends_table_list(word.keyword)
            || is_join_noise(word.keyword)
            || introduces_table(word.keyword))
}

/// Every table named by a statement's tokens.
pub fn scan(tokens: &[TokenWithSpan]) -> Vec<SourceRef> {
    let mut sources = Vec::new();
    let mut at = 0;

    while at < tokens.len() {
        let introduces = word(&tokens[at]).map(|word| introduces_table(word.keyword)).unwrap_or(false);
        at += 1;
        if !introduces {
            continue;
        }
        at = read_table_list(tokens, at, &mut sources);
    }

    sources
}

/// Reads the comma separated list of tables that follows a `FROM` or a `JOIN`.
///
/// Returns where the list ended, so the outer scan resumes there rather than re-reading the
/// clause's own words as though each were a table.
fn read_table_list(tokens: &[TokenWithSpan], mut at: usize, sources: &mut Vec<SourceRef>) -> usize {
    loop {
        // A parenthesized source is either a derived table or a nested join. Either way it names
        // nothing that can be looked up in the schema, so it is skipped whole.
        let named = if matches!(tokens.get(at).map(|token| &token.token), Some(Token::LParen)) {
            at = skip_parenthesized(tokens, at);
            false
        } else {
            match read_table(tokens, at) {
                Some((source, next)) => {
                    sources.push(source);
                    at = next;
                    true
                }
                None => return at,
            }
        };

        let (alias, next) = read_alias(tokens, at);
        at = next;
        if named {
            if let Some(source) = sources.last_mut() {
                source.alias = alias;
            }
        }

        match tokens.get(at).map(|token| &token.token) {
            // Another table in the same FROM clause.
            Some(Token::Comma) => at += 1,
            Some(Token::Word(word)) if is_join_noise(word.keyword) => at += 1,

            _ => return at,
        }
    }
}

/// Reads one dotted table name, returning it and the index just past it.
fn read_table(tokens: &[TokenWithSpan], mut at: usize) -> Option<(SourceRef, usize)> {
    let mut parts: Vec<String> = Vec::new();
    loop {
        let word = word(tokens.get(at)?)?;
        if !can_be_name(word) {
            return None;
        }
        parts.push(word.value.clone());
        at += 1;
        if matches!(tokens.get(at).map(|token| &token.token), Some(Token::Period)) {
            at += 1;
            continue;
        }
        break;
    }

    // Read from the right: the last part is the table, the one before it the schema, the one
    // before that the catalog.
    let part = |back: usize| parts.len().checked_sub(back).and_then(|at| parts.get(at)).cloned();
    Some((
        SourceRef { name: part(1)?, schema: part(2), catalog: part(3), alias: None },
        at,
    ))
}

/// Reads the alias a table was given, if it has one, and where it ended.
fn read_alias(tokens: &[TokenWithSpan], mut at: usize) -> (Option<String>, usize) {
    let explicit = matches!(
        tokens.get(at).and_then(word).map(|word| word.keyword),
        Some(Keyword::AS)
    );
    if explicit {
        at += 1;
    }
    // `FROM orders WHERE` must not read `WHERE` as the alias of `orders`.
    match tokens.get(at).and_then(word) {
        Some(word) if can_be_name(word) => (Some(word.value.clone()), at + 1),
        _ => (None, at),
    }
}

/// Skips a parenthesized group, balanced, returning the index just past its closing paren.
fn skip_parenthesized(tokens: &[TokenWithSpan], mut at: usize) -> usize {
    let mut depth = 0usize;
    while at < tokens.len() {
        match tokens[at].token {
            Token::LParen => depth += 1,
            Token::RParen => {
                depth -= 1;
                if depth == 0 {
                    return at + 1;
                }
            }
            _ => {}
        }
        at += 1;
    }
    at
}

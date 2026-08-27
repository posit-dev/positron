/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

//! Resolving the dialect the user configured, and the keywords worth completing.

use sqlparser::dialect::{dialect_from_str, Dialect, GenericDialect};

/// Names this accepts that sqlparser spells differently, or does not have a parser for.
///
/// The first group is spelling: a setting written before this extension parsed with sqlparser
/// named its dialects the way SQLGlot did, and a user who chose `tsql` from the settings list
/// meant Transact-SQL, not "fall back to generic". The second group is dialects with no parser of
/// their own but a close enough relative to be better than nothing.
const ALIASES: &[(&str, &str)] = &[
    // Spelled differently by sqlparser.
    ("tsql", "mssql"),
    ("spark", "sparksql"),
    ("spark2", "sparksql"),
    ("mariadb", "mysql"),
    // No parser of their own. Presto and its descendants are close to ANSI; Athena is Presto.
    ("presto", "ansi"),
    ("trino", "ansi"),
    ("athena", "ansi"),
];

/// Resolves a configured dialect name to one sqlparser implements.
///
/// Returns the dialect and whether the name was recognized. An unknown name falls back to the
/// permissive generic dialect rather than failing every request: the setting is a plain string in
/// the user's settings.json, so a typo, or a dialect from a newer Positron, is reachable, and
/// neither should leave a SQL file with no diagnostics and no explanation. The caller says so
/// once rather than silently parsing as something the user did not ask for.
pub fn resolve(name: &str) -> (Box<dyn Dialect>, bool) {
    let normalized = name.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return (Box::new(GenericDialect {}), true);
    }
    if let Some(dialect) = dialect_from_str(&normalized) {
        return (dialect, true);
    }
    let aliased = ALIASES
        .iter()
        .find(|(from, _)| *from == normalized)
        .and_then(|(_, to)| dialect_from_str(to));
    match aliased {
        Some(dialect) => (dialect, true),
        None => (Box::new(GenericDialect {}), false),
    }
}

/// Multi-word keywords worth offering as one completion.
///
/// sqlparser tokenizes each word separately and its keyword table has no notion of a phrase, so
/// unlike SQLGlot's it holds no `GROUP BY`. These are the phrases common enough that completing
/// them whole saves a real keystroke; the single words they are built from are still offered
/// individually from [`ALL_KEYWORDS`](sqlparser::keywords::ALL_KEYWORDS).
const PHRASES: &[&str] = &[
    "CROSS JOIN",
    "DELETE FROM",
    "FULL OUTER JOIN",
    "GROUP BY",
    "INNER JOIN",
    "INSERT INTO",
    "IS NOT NULL",
    "IS NULL",
    "LEFT JOIN",
    "LEFT OUTER JOIN",
    "NOT NULL",
    "ORDER BY",
    "OUTER JOIN",
    "PARTITION BY",
    "PRIMARY KEY",
    "RIGHT JOIN",
    "RIGHT OUTER JOIN",
    "UNION ALL",
    "WITH RECURSIVE",
];

/// Every keyword the completion list offers, sorted and deduplicated.
///
/// sqlparser keeps one keyword table for all dialects, so unlike the SQLGlot implementation this
/// does not vary with the configured dialect. Offering a keyword a dialect does not have costs an
/// entry in a list the user is filtering by prefix anyway; withholding one it does have would
/// cost a completion that ought to work.
pub fn keywords() -> Vec<String> {
    let mut all: Vec<String> = sqlparser::keywords::ALL_KEYWORDS
        .iter()
        .map(|keyword| (*keyword).to_string())
        .chain(PHRASES.iter().map(|phrase| (*phrase).to_string()))
        .collect();
    all.sort_unstable();
    all.dedup();
    all
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

//! Resolving the dialect the user configured.

use sqlparser::dialect::{dialect_from_str, Dialect, GenericDialect};

/// Every dialect sqlparser implements, under the one spelling this crate uses for it: the list
/// [`canonical`] maps into.
pub const CANONICAL: &[&str] = &[
    "generic",
    "ansi",
    "bigquery",
    "clickhouse",
    "databricks",
    "duckdb",
    "hive",
    "mssql",
    "mysql",
    "oracle",
    "postgres",
    "redshift",
    "snowflake",
    "sparksql",
    "sqlite",
    "teradata",
];

/// Names this accepts that sqlparser spells differently, or does not have a parser for.
///
/// The first group is spelling: a setting written before this extension parsed with sqlparser
/// named its dialects the way SQLGlot did, and a user who chose `tsql` from the settings list
/// meant Transact-SQL, not "fall back to generic". The second group is dialects with no parser of
/// their own but a close enough relative to be better than nothing.
const ALIASES: &[(&str, &str)] = &[
    // Spelled differently by sqlparser.
    ("tsql", "mssql"),
    ("postgresql", "postgres"),
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
    match canonical(name) {
        // Every entry of CANONICAL is a name `dialect_from_str` knows, which the tests pin.
        Some(name) => (
            dialect_from_str(name).unwrap_or_else(|| Box::new(GenericDialect {})),
            true,
        ),
        None => (Box::new(GenericDialect {}), false),
    }
}

/// The entry of [`CANONICAL`] a configured name means, or `None` if it means nothing.
fn canonical(name: &str) -> Option<&'static str> {
    let normalized = name.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return Some("generic");
    }
    if let Some(found) = CANONICAL.iter().find(|known| **known == normalized) {
        return Some(found);
    }
    if let Some((_, to)) = ALIASES.iter().find(|(from, _)| *from == normalized) {
        return CANONICAL.iter().copied().find(|known| known == to);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::CANONICAL;
    use sqlparser::dialect::dialect_from_str;

    #[test]
    fn every_canonical_name_is_one_sqlparser_knows() {
        // `resolve` would otherwise parse a recognized dialect as generic without saying so.
        let unknown: Vec<&str> =
            CANONICAL.iter().copied().filter(|name| dialect_from_str(name).is_none()).collect();
        assert_eq!(unknown, Vec::<&str>::new());
    }
}

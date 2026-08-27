/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

//! Which of `keywords.rs`'s candidates each dialect's parser actually accepts.
//!
//! GENERATED FILE -- do not edit. Run `npm run build-keywords` and commit the result.
//! The generator, and the reasoning behind the rule it applies, are in
//! `tests/keyword_table.rs`.

/// The keywords every dialect offers, indexed by position as `keywords::POSITIONS` is.
pub const BASE: &[&[&str]] = &[
    // statementStart
    &[
        "ALTER TABLE", "ALTER VIEW", "ANALYZE", "BEGIN", "CALL", "COMMIT", "COPY", "CREATE",
        "CREATE INDEX", "CREATE MATERIALIZED VIEW", "CREATE OR REPLACE VIEW", "CREATE SCHEMA",
        "CREATE TABLE", "CREATE TEMPORARY TABLE", "CREATE VIEW", "DELETE FROM", "DESCRIBE",
        "DROP INDEX", "DROP TABLE", "DROP VIEW", "EXECUTE", "EXPLAIN", "GRANT", "INSERT INTO",
        "MERGE INTO", "PRAGMA", "PREPARE", "REVOKE", "ROLLBACK", "SELECT", "SET", "SHOW",
        "START TRANSACTION", "TRUNCATE TABLE", "UPDATE", "USE", "VACUUM", "VALUES", "WITH",
        "WITH RECURSIVE",
    ],
    // ddl
    &[
        "DATABASE", "EXTERNAL TABLE", "FUNCTION", "INDEX", "MATERIALIZED VIEW", "OR REPLACE",
        "PROCEDURE", "SCHEMA", "SEQUENCE", "TABLE", "TEMPORARY TABLE", "UNIQUE INDEX", "VIEW",
    ],
    // selectStart
    &[
        "ALL", "ARRAY", "CASE", "CAST", "COALESCE", "COUNT", "CURRENT_DATE", "CURRENT_TIME",
        "CURRENT_TIMESTAMP", "CURRENT_USER", "DATE", "DEFAULT", "DISTINCT", "DISTINCT ON",
        "EXISTS", "EXTRACT", "FALSE", "INTERVAL", "MAX", "MIN", "NOT", "NULL", "NULLIF",
        "SUBSTRING", "SUM", "TIME", "TIMESTAMP", "TOP", "TRIM", "TRUE", "TRY_CAST",
    ],
    // selectItem
    &[
        "AND", "AS", "AT TIME ZONE", "BETWEEN", "COLLATE", "EXCEPT", "FROM", "ILIKE", "IN",
        "INTERSECT", "INTO", "IS", "IS DISTINCT FROM", "IS FALSE", "IS NOT DISTINCT FROM",
        "IS NOT NULL", "IS NULL", "IS TRUE", "LIKE", "MINUS", "NOT BETWEEN", "NOT ILIKE", "NOT IN",
        "NOT LIKE", "OR", "OVER", "OVERLAPS", "RLIKE", "SIMILAR TO", "UNION", "UNION ALL",
        "WITHIN GROUP",
    ],
    // name
    &["IF EXISTS", "IF NOT EXISTS", "LATERAL", "TABLE"],
    // tableItem
    &[
        "AS", "CROSS JOIN", "FETCH", "FULL JOIN", "FULL OUTER JOIN", "GROUP BY", "HAVING",
        "INNER JOIN", "JOIN", "LEFT JOIN", "LEFT OUTER JOIN", "LIMIT", "NATURAL JOIN", "OFFSET",
        "ORDER BY", "PIVOT", "QUALIFY", "RETURNING", "RIGHT JOIN", "RIGHT OUTER JOIN",
        "TABLESAMPLE", "UNPIVOT", "WHERE", "WINDOW",
    ],
    // joinedItem
    &[
        "AS", "CROSS JOIN", "FETCH", "FULL JOIN", "FULL OUTER JOIN", "GROUP BY", "HAVING",
        "INNER JOIN", "JOIN", "LEFT JOIN", "LEFT OUTER JOIN", "LIMIT", "NATURAL JOIN", "OFFSET",
        "ON", "ORDER BY", "PIVOT", "QUALIFY", "RIGHT JOIN", "RIGHT OUTER JOIN", "TABLESAMPLE",
        "UNPIVOT", "USING", "WHERE", "WINDOW",
    ],
    // updateItem
    &["AS", "FROM", "PIVOT", "SET", "TABLESAMPLE", "UNPIVOT"],
    // insertTarget
    &["DEFAULT VALUES", "SELECT", "VALUES", "WITH"],
    // value
    &[
        "ARRAY", "CASE", "CAST", "COALESCE", "COUNT", "CUBE", "CURRENT_DATE", "CURRENT_TIME",
        "CURRENT_TIMESTAMP", "CURRENT_USER", "DATE", "DEFAULT", "EXISTS", "EXTRACT", "FALSE",
        "GROUPING SETS", "INTERVAL", "MAX", "MIN", "NOT", "NULL", "NULLIF", "ROLLUP", "SUBSTRING",
        "SUM", "TIME", "TIMESTAMP", "TRIM", "TRUE", "TRY_CAST",
    ],
    // subquery
    &[
        "ALL", "ARRAY", "CASE", "CAST", "COALESCE", "COUNT", "CUBE", "CURRENT_DATE",
        "CURRENT_TIME", "CURRENT_TIMESTAMP", "CURRENT_USER", "DATE", "DEFAULT", "DISTINCT",
        "EXISTS", "EXTRACT", "FALSE", "GROUPING SETS", "INTERVAL", "MAX", "MIN", "NOT", "NULL",
        "NULLIF", "ROLLUP", "SELECT", "SUBSTRING", "SUM", "TIME", "TIMESTAMP", "TRIM", "TRUE",
        "TRY_CAST", "VALUES", "WITH",
    ],
    // expression
    &[
        "AND", "AT TIME ZONE", "BETWEEN", "COLLATE", "EXCEPT", "FETCH", "FOR UPDATE", "GROUP BY",
        "HAVING", "ILIKE", "IN", "INTERSECT", "IS", "IS DISTINCT FROM", "IS FALSE",
        "IS NOT DISTINCT FROM", "IS NOT NULL", "IS NULL", "IS TRUE", "LIKE", "LIMIT", "MINUS",
        "NOT BETWEEN", "NOT ILIKE", "NOT IN", "NOT LIKE", "OFFSET", "OR", "ORDER BY", "OVERLAPS",
        "QUALIFY", "RLIKE", "SIMILAR TO", "UNION", "UNION ALL", "WINDOW",
    ],
    // orderItem
    &[
        "AND", "ASC", "AT TIME ZONE", "BETWEEN", "COLLATE", "DESC", "FETCH", "FOR UPDATE", "ILIKE",
        "IN", "IS", "IS DISTINCT FROM", "IS FALSE", "IS NOT DISTINCT FROM", "IS NOT NULL",
        "IS NULL", "IS TRUE", "LIKE", "LIMIT", "NOT BETWEEN", "NOT ILIKE", "NOT IN", "NOT LIKE",
        "NULLS FIRST", "NULLS LAST", "OFFSET", "OR", "OVERLAPS", "RLIKE", "SIMILAR TO",
    ],
    // windowSpec
    &[
        "CURRENT ROW", "FOLLOWING", "GROUPS", "ORDER BY", "PARTITION BY", "PRECEDING", "RANGE",
        "ROWS", "UNBOUNDED FOLLOWING", "UNBOUNDED PRECEDING",
    ],
    // columnDefinition
    &[
        "ARRAY", "AUTOINCREMENT", "BIGINT", "BLOB", "BOOLEAN", "BYTEA", "CHAR", "CHECK", "COLLATE",
        "COMMENT", "CONSTRAINT", "DATE", "DECIMAL", "DEFAULT", "DOUBLE", "DOUBLE PRECISION",
        "FLOAT", "GENERATED ALWAYS AS", "INT", "INTEGER", "INTERVAL", "JSON", "JSONB", "NOT NULL",
        "NULL", "NUMERIC", "PRIMARY KEY", "REAL", "REFERENCES", "SMALLINT", "TEXT", "TIME",
        "TIMESTAMP", "TIMESTAMP WITH TIME ZONE", "TINYINT", "UNIQUE", "UUID", "VARCHAR",
    ],
    // expectingBy
    &["BY"],
    // expectingJoin
    &["ANTI JOIN", "JOIN", "OUTER", "OUTER JOIN", "SEMI JOIN"],
    // expectingNullsOrder
    &["FIRST", "LAST"],
    // expectingIsPredicate
    &[
        "DISTINCT FROM", "FALSE", "NOT", "NOT DISTINCT FROM", "NOT FALSE", "NOT NULL", "NOT TRUE",
        "NULL", "TRUE", "UNKNOWN",
    ],
];

/// The keywords a single dialect offers on top of [`BASE`], as `(dialect, position, added)`.
///
/// Only ever additive: a keyword most dialects accept is offered to all of them, so the
/// entries here are the few that genuinely belong to a handful of dialects.
pub const EXTRA: &[(&str, usize, &[&str])] = &[
    ("bigquery", 4, &["UNNEST"]), // name
    ("databricks", 3, &["FILTER"]), // selectItem
    ("duckdb", 3, &["FILTER"]), // selectItem
    ("generic", 1, &["TRIGGER"]), // ddl
    ("generic", 3, &["FILTER"]), // selectItem
    ("generic", 4, &["UNNEST"]), // name
    ("generic", 5, &["MATCH_RECOGNIZE"]), // tableItem
    ("generic", 6, &["MATCH_RECOGNIZE"]), // joinedItem
    ("generic", 7, &["MATCH_RECOGNIZE"]), // updateItem
    ("hive", 3, &["FILTER"]), // selectItem
    ("mssql", 1, &["TRIGGER"]), // ddl
    ("mysql", 1, &["TRIGGER"]), // ddl
    ("oracle", 5, &["MATCH_RECOGNIZE"]), // tableItem
    ("oracle", 6, &["MATCH_RECOGNIZE"]), // joinedItem
    ("oracle", 7, &["MATCH_RECOGNIZE"]), // updateItem
    ("oracle", 8, &["AS"]), // insertTarget
    ("postgres", 0, &["LISTEN", "NOTIFY", "UNLISTEN"]), // statementStart
    ("postgres", 1, &["TRIGGER"]), // ddl
    ("postgres", 3, &["FILTER"]), // selectItem
    ("postgres", 4, &["UNNEST"]), // name
    ("postgres", 8, &["AS"]), // insertTarget
    ("snowflake", 7, &["MATCH_RECOGNIZE"]), // updateItem
    ("sparksql", 3, &["FILTER"]), // selectItem
    ("sqlite", 1, &["TRIGGER"]), // ddl
    ("sqlite", 3, &["FILTER"]), // selectItem
];

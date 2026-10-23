/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

//! Which names a completion has to quote to have them read as names.

mod support;

use serde_json::json;
use support::request;

fn quoted(dialect: &str, names: &[&str]) -> Vec<bool> {
    request(json!({ "op": "quoting", "dialect": dialect, "names": names }))["quoted"]
        .as_array()
        .unwrap()
        .iter()
        .map(|answer| answer.as_bool().unwrap())
        .collect()
}

#[test]
fn an_ordinary_name_is_written_bare() {
    assert_eq!(
        quoted("postgres", &["orders", "customer_id", "_x1"]),
        [false, false, false]
    );
}

#[test]
fn a_name_that_is_not_an_identifier_is_quoted() {
    assert_eq!(
        quoted("duckdb", &["Order Date", "1st", "a-b", ""]),
        [true, true, true, true]
    );
}

#[test]
fn a_reserved_word_is_quoted() {
    for dialect in ["", "postgres", "duckdb", "sqlite", "snowflake", "mysql"] {
        assert_eq!(
            quoted(dialect, &["order", "group", "select", "from"]),
            [true; 4],
            "{dialect}"
        );
    }
}

#[test]
fn a_keyword_that_still_reads_as_a_name_is_written_bare() {
    assert_eq!(
        quoted("postgres", &["name", "status", "value"]),
        [false, false, false]
    );
}

#[test]
fn a_keyword_that_reads_as_something_else_is_quoted() {
    // Bare, `user` is the current user in PostgreSQL rather than a column called user.
    assert_eq!(quoted("postgres", &["user"]), [true]);
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

//! Reading a statement's tables off its tokens, which is what completion runs on.
//!
//! Every case here is SQL that is halfway through being typed, because that is the state the
//! document is in whenever completion is asked for. None of it parses.

mod support;

use serde_json::json;
use support::{cursor, request};

/// The tables the statement at `offset` names, as `name` or `name AS alias`.
fn sources(text: &str, offset: usize) -> Vec<String> {
    request(json!({ "op": "sources", "text": text, "offset": offset }))["sources"]
        .as_array()
        .unwrap()
        .iter()
        .map(|source| {
            let qualified = ["catalog", "schema", "name"]
                .iter()
                .filter_map(|part| source[*part].as_str())
                .collect::<Vec<_>>()
                .join(".");
            match source["alias"].as_str() {
                Some(alias) => format!("{qualified} AS {alias}"),
                None => qualified,
            }
        })
        .collect()
}

/// The tables named by the statement the cursor is in, with the cursor written as `|`.
fn at_cursor(marked: &str) -> Vec<String> {
    let (text, offset) = cursor(marked);
    sources(&text, offset as usize)
}

#[test]
fn a_name_that_is_also_a_keyword_is_still_read() {
    // sqlparser's keyword table is global and over a thousand entries, so plenty of ordinary
    // table and schema names are in it.
    assert_eq!(at_cursor("SELECT | FROM warehouse.orders"), ["warehouse.orders"]);
    assert_eq!(at_cursor("SELECT | FROM value v"), ["value AS v"]);
}

#[test]
fn a_table_is_read_with_its_alias() {
    assert_eq!(at_cursor("SELECT | FROM orders o"), ["orders AS o"]);
    assert_eq!(at_cursor("SELECT | FROM orders AS o"), ["orders AS o"]);
    assert_eq!(at_cursor("SELECT | FROM orders"), ["orders"]);
}

#[test]
fn a_qualified_table_keeps_its_namespace() {
    assert_eq!(at_cursor("SELECT | FROM warehouse.sales.orders"), ["warehouse.sales.orders"]);
    assert_eq!(at_cursor("SELECT | FROM sales.orders"), ["sales.orders"]);
}

#[test]
fn every_joined_table_is_read() {
    assert_eq!(
        at_cursor("SELECT | FROM orders o JOIN customers c ON c.id = o.cid LEFT OUTER JOIN refunds r ON true"),
        ["orders AS o", "customers AS c", "refunds AS r"]
    );
}

#[test]
fn a_comma_separated_from_clause_is_read() {
    assert_eq!(at_cursor("SELECT | FROM orders o, customers c"), ["orders AS o", "customers AS c"]);
}

#[test]
fn a_clause_keyword_is_not_read_as_an_alias() {
    // The whole point of the scan: `WHERE` ends the FROM list rather than naming the table.
    assert_eq!(at_cursor("SELECT x FROM orders WHERE |"), ["orders"]);
    assert_eq!(at_cursor("SELECT x FROM orders GROUP BY |"), ["orders"]);
    assert_eq!(at_cursor("SELECT x FROM orders ORDER BY |"), ["orders"]);
}

#[test]
fn a_statement_that_cannot_parse_still_gives_up_its_tables() {
    // sqlparser has no error recovery, so nothing below would work off a tree. An empty select
    // list, a trailing dot and a half typed quoted identifier are all ordinary states to be in
    // partway through typing.
    assert_eq!(at_cursor("SELECT | FROM orders o"), ["orders AS o"]);
    assert_eq!(at_cursor("SELECT o.| FROM orders o"), ["orders AS o"]);
    assert_eq!(at_cursor("SELECT a, FROM orders o WHERE |"), ["orders AS o"]);
}

#[test]
fn an_unclosed_quote_costs_the_statement_its_tables() {
    // The one state the scan cannot see through, because the tokenizer cannot: an identifier
    // whose opening quote is never closed swallows the rest of the document. The caller
    // substitutes a plain identifier for the one being typed before asking, which is what makes
    // `o."Order T` an ordinary statement again.
    assert!(at_cursor("SELECT o.\"Order T| FROM orders o").is_empty());
    assert_eq!(at_cursor("SELECT o.placeholder| FROM orders o"), ["orders AS o"]);
}

#[test]
fn a_write_target_is_read_too() {
    assert_eq!(at_cursor("INSERT INTO orders (|)"), ["orders"]);
    assert_eq!(at_cursor("UPDATE orders SET |"), ["orders"]);
    assert_eq!(at_cursor("DELETE FROM orders WHERE |"), ["orders"]);
}

#[test]
fn a_derived_table_names_nothing_but_does_not_swallow_its_neighbours() {
    assert_eq!(
        at_cursor("SELECT | FROM (SELECT 1 AS n) d JOIN customers c ON true"),
        ["customers AS c"]
    );
}

#[test]
fn a_quoted_table_name_is_read_unquoted() {
    assert_eq!(at_cursor("SELECT | FROM \"Order Details\" d"), ["Order Details AS d"]);
}

#[test]
fn only_the_statement_the_cursor_is_in_is_read() {
    // Completions in one statement must not be scoped to the tables of the one above it.
    assert_eq!(at_cursor("SELECT a FROM orders;\nSELECT | FROM customers"), ["customers"]);
}

#[test]
fn a_cursor_between_statements_names_nothing() {
    // What the user types there starts a new statement, which reads from nothing yet.
    assert!(at_cursor("SELECT a FROM orders;\n|\nSELECT b FROM customers").is_empty());
}

#[test]
fn a_cursor_directly_after_a_semicolon_names_nothing() {
    // The semicolon ended the statement, so what the user types next is a new one and must not be
    // scoped to the tables of the one above.
    assert!(at_cursor("SELECT a FROM orders;|").is_empty());
    assert_eq!(at_cursor("SELECT a FROM orders|").as_slice(), ["orders"]);
}

#[test]
fn a_cursor_in_an_empty_document_names_nothing() {
    assert!(sources("", 0).is_empty());
    assert!(sources("   ", 3).is_empty());
}

#[test]
fn an_offset_past_the_end_of_the_document_is_answered_rather_than_failing() {
    assert_eq!(sources("SELECT a FROM orders", 9999), ["orders"]);
}

#[test]
fn a_subquery_in_a_where_clause_does_not_leak_its_tables_into_the_scan() {
    // The scan is flat rather than scoped, which is what completion wants: everything the
    // statement mentions is worth offering. It just must not lose the outer table.
    assert_eq!(
        at_cursor("SELECT | FROM orders o WHERE cid IN (SELECT id FROM customers)"),
        ["orders AS o", "customers"]
    );
}

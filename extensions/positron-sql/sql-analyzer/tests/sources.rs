/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

//! What the statement under the cursor can see from there, which is what completion runs on.
//!
//! Every case here is SQL that is halfway through being typed, because that is the state the
//! document is in whenever completion is asked for. Almost none of it parses as written -- an
//! identifier is written into the hole the cursor is in first, which is what makes it parse and
//! what says where in the resulting tree the cursor ended up.

mod support;

use serde_json::{json, Value};
use support::{cursor, request};

fn ask(text: &str, offset: usize) -> Value {
    request(json!({ "op": "sources", "text": text, "offset": offset }))
}

/// The tables the statement at `offset` can see, as `name` or `name AS alias`.
fn sources(text: &str, offset: usize) -> Vec<String> {
    named(&ask(text, offset))
}

fn named(response: &Value) -> Vec<String> {
    response["sources"]
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

/// The tables the statement the cursor is in can see, with the cursor written as `|`.
fn at_cursor(marked: &str) -> Vec<String> {
    let (text, offset) = cursor(marked);
    sources(&text, offset as usize)
}

/// The whole answer at a cursor: its tables, the names the statement defines, whether the scope
/// can be judged, and which of the two ways of answering produced it.
fn all_at_cursor(marked: &str) -> (Vec<String>, Vec<String>, bool, String) {
    let (text, offset) = cursor(marked);
    let response = ask(&text, offset as usize);
    (
        named(&response),
        response["locals"]
            .as_array()
            .unwrap()
            .iter()
            .map(|local| local.as_str().unwrap().to_string())
            .collect(),
        response["opaque"].as_bool().unwrap(),
        response["origin"].as_str().unwrap().to_string(),
    )
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
    // The one state neither way of answering can see through, because the tokenizer cannot: an
    // identifier whose opening quote is never closed swallows the rest of its line, `FROM orders
    // o` included. The caller substitutes a plain identifier for the one being typed before
    // asking, which is what makes `o."Order T` an ordinary statement again.
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
    assert_eq!(at_cursor("SELECT a FROM orders |").as_slice(), ["orders"]);
}

#[test]
fn the_table_name_being_typed_is_not_read_as_one_the_statement_has() {
    // The cursor is in the slot where a table name goes, so what is under it is a name being
    // written rather than a table the statement reads from -- there is not one yet.
    assert!(at_cursor("SELECT a FROM ord|").is_empty());
    assert!(at_cursor("SELECT a FROM orders|").is_empty());
    assert_eq!(at_cursor("SELECT a FROM orders, cust|").as_slice(), ["orders"]);
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
fn a_subquery_does_not_offer_its_tables_to_the_statement_around_it() {
    // The outer select cannot see `customers` at all, so offering its columns there would be
    // offering names that are errors. This is what the scan could not do and the parse can.
    assert_eq!(
        at_cursor("SELECT | FROM orders o WHERE cid IN (SELECT id FROM customers)"),
        ["orders AS o"]
    );
}

#[test]
fn a_cursor_inside_a_subquery_sees_out_of_it() {
    // The other direction, and it has to stay open: a correlated subquery may refer to a table of
    // the query around it, so the tables of both are in scope, nearest first.
    assert_eq!(
        at_cursor("SELECT * FROM orders o WHERE cid IN (SELECT | FROM customers c)"),
        ["customers AS c", "orders AS o"]
    );
}

#[test]
fn a_cte_offers_its_own_name_rather_than_the_tables_inside_it() {
    // The whole reason the answer is scoped. A flat read of the tokens finds `orders` and would
    // offer its columns in the outer select, which cannot see them: what that select reads from
    // is `recent`, whose columns are whatever the CTE chose to select.
    let (sources, locals, opaque, origin) =
        all_at_cursor("WITH recent AS (SELECT id FROM orders) SELECT | FROM recent");
    assert!(sources.is_empty(), "got {sources:?}");
    assert_eq!(locals, ["recent"]);
    assert!(opaque, "a column here may be one of the CTE's, which cannot be known");
    assert_eq!(origin, "parsed");
}

#[test]
fn a_cursor_inside_a_cte_sees_the_tables_the_cte_reads() {
    assert_eq!(
        at_cursor("WITH recent AS (SELECT | FROM orders) SELECT id FROM recent"),
        ["orders"]
    );
}

#[test]
fn a_cursor_inside_an_unclosed_subquery_still_reads_it() {
    // The bracket the author has not reached yet is supplied, so a subquery being typed is a
    // subquery rather than a statement that cannot be parsed at all.
    assert_eq!(at_cursor("SELECT * FROM orders WHERE id IN (SELECT | FROM customers"), [
        "customers",
        "orders"
    ]);
}

#[test]
fn a_statement_the_parse_cannot_rescue_falls_back_to_its_tokens() {
    // Filling the hole in is not error recovery, so there is still SQL it cannot make sense of.
    // The token scan is what the answer was before any of this, and it is still there.
    let (sources, locals, opaque, origin) = all_at_cursor("SELECT a,, b FROM orders o WHERE |");
    assert_eq!(sources, ["orders AS o"]);
    assert!(locals.is_empty());
    assert!(!opaque);
    assert_eq!(origin, "tokens");
}

#[test]
fn the_answer_says_which_way_it_was_reached() {
    // A scoped answer and a flat one are worth telling apart in the log, since a surprising list
    // is otherwise indistinguishable from a broken one.
    assert_eq!(all_at_cursor("SELECT | FROM orders").3, "parsed");
}

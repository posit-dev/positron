/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

//! What a statement says about the names in it: which tables it reads, and what each column can
//! be resolved against.
//!
//! The analyzer never sees the user's schema, so nothing here is about a name being *known*. What
//! it pins down is the structure the caller needs to decide that -- above all, which columns are
//! in a scope that cannot be judged at all.

mod support;

use serde_json::Value;
use support::{analyze, slice};

/// The real tables a document reads, as `(qualified name, alias)`.
fn tables(text: &str) -> Vec<(String, Option<String>)> {
    analyze(text)["tables"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|table| !table["local"].as_bool().unwrap() && !table["definition"].as_bool().unwrap())
        .map(|table| (qualified(table), table["alias"].as_str().map(str::to_string)))
        .collect()
}

fn qualified(table: &Value) -> String {
    [&table["catalog"], &table["schema"], &table["name"]]
        .iter()
        .filter_map(|part| part.as_str())
        .collect::<Vec<_>>()
        .join(".")
}

/// Every column, as `(name, qualifier, whether its scope can be judged)`.
fn columns(text: &str) -> Vec<(String, Option<String>, bool)> {
    let response = analyze(text);
    let scopes = response["scopes"].as_array().unwrap();
    response["columns"]
        .as_array()
        .unwrap()
        .iter()
        .map(|column| {
            let scope = &scopes[column["scope"].as_u64().unwrap() as usize];
            let judgeable =
                !scope["opaque"].as_bool().unwrap() && !scope["tables"].as_array().unwrap().is_empty();
            (
                column["name"].as_str().unwrap().to_string(),
                column["qualifier"].as_str().map(str::to_string),
                judgeable,
            )
        })
        .collect()
}

/// The tables a column can be resolved against, by its scope.
fn visible(text: &str, column_name: &str) -> Vec<String> {
    let response = analyze(text);
    let scopes = response["scopes"].as_array().unwrap();
    let all = response["tables"].as_array().unwrap();
    let column = response["columns"]
        .as_array()
        .unwrap()
        .iter()
        .find(|column| column["name"].as_str() == Some(column_name))
        .unwrap_or_else(|| panic!("no column named {column_name}"));
    scopes[column["scope"].as_u64().unwrap() as usize]["tables"]
        .as_array()
        .unwrap()
        .iter()
        .map(|at| qualified(&all[at.as_u64().unwrap() as usize]))
        .collect()
}

#[test]
fn a_table_is_reported_with_its_namespace_and_alias() {
    assert_eq!(
        tables("SELECT * FROM sales.orders o"),
        [("sales.orders".to_string(), Some("o".to_string()))]
    );
}

#[test]
fn the_range_covers_the_name_without_its_qualifier() {
    // What gets squiggled, and what a document link covers. The `sales.` is not part of it.
    let text = "SELECT * FROM sales.orders";
    let response = analyze(text);
    assert_eq!(slice(text, &response["tables"][0]), "orders");
}

#[test]
fn a_quoted_name_is_covered_along_with_its_quotes() {
    // What gets squiggled, and what a document link covers. Including the quotes means clicking
    // anywhere on the name follows the link, and an underline under the whole thing.
    let text = "SELECT \"Total\" FROM \"Order Details\"";
    let response = analyze(text);
    assert_eq!(slice(text, &response["tables"][0]), "\"Order Details\"");
    assert_eq!(slice(text, &response["columns"][0]), "\"Total\"");
}

#[test]
fn tables_in_writes_are_resolved_too() {
    assert_eq!(tables("INSERT INTO customers (id) VALUES (1)"), [("customers".to_string(), None)]);
    assert_eq!(tables("UPDATE customers SET id = 1"), [("customers".to_string(), None)]);
    assert_eq!(tables("DELETE FROM customers WHERE id = 1"), [("customers".to_string(), None)]);
}

#[test]
fn a_columns_of_a_write_target_resolve_against_it() {
    assert_eq!(visible("UPDATE customers SET name = 'x' WHERE id = 1", "name"), ["customers"]);
}

#[test]
fn a_table_valued_function_is_not_a_table() {
    assert!(tables("SELECT * FROM generate_series(1, 10)").is_empty());
}

#[test]
fn the_object_a_create_defines_is_not_a_table_reference() {
    // It does not exist in the schema yet by construction, so reporting it missing would squiggle
    // every CREATE the user writes.
    assert!(tables("CREATE TABLE new_orders (id int)").is_empty());
    assert!(tables("CREATE VIEW v AS SELECT 1").is_empty());
    // The table a CREATE reads from does have to exist.
    assert_eq!(tables("CREATE VIEW v AS SELECT * FROM orders"), [("orders".to_string(), None)]);
}

#[test]
fn a_drop_still_names_a_table_that_has_to_exist() {
    assert_eq!(tables("DROP TABLE orders"), [("orders".to_string(), None)]);
}

#[test]
fn a_column_is_scoped_to_the_table_it_is_qualified_by() {
    let text = "SELECT o.total, c.name FROM orders o JOIN customers c ON c.id = o.cid";
    assert_eq!(
        columns(text),
        [
            ("total".to_string(), Some("o".to_string()), true),
            ("name".to_string(), Some("c".to_string()), true),
            ("id".to_string(), Some("c".to_string()), true),
            ("cid".to_string(), Some("o".to_string()), true),
        ]
    );
}

#[test]
fn a_column_sees_every_joined_table() {
    assert_eq!(
        visible("SELECT total FROM orders JOIN customers ON true", "total"),
        ["orders", "customers"]
    );
}

#[test]
fn star_is_not_a_column() {
    assert!(columns("SELECT * FROM orders").is_empty());
    assert!(columns("SELECT o.* FROM orders o").is_empty());
}

#[test]
fn a_cte_is_not_a_table_reference() {
    // Referring to a CTE is correct SQL; reporting it as a missing table would be a squiggle on
    // something the user got right.
    assert!(tables("WITH recent AS (SELECT 1 AS id) SELECT id FROM recent").is_empty());
}

#[test]
fn a_cte_body_still_names_its_own_tables() {
    assert_eq!(
        tables("WITH recent AS (SELECT id FROM orders) SELECT id FROM recent"),
        [("orders".to_string(), None)]
    );
}

#[test]
fn a_column_from_a_cte_is_not_judged() {
    // The outer select cannot see `orders` at all, so judging `x` against it would report a name
    // that may well be a real column of the CTE.
    let text = "WITH recent AS (SELECT id FROM orders) SELECT x FROM recent";
    let judged: Vec<_> = columns(text).into_iter().filter(|(_, _, judgeable)| *judgeable).collect();
    assert_eq!(judged, [("id".to_string(), None, true)], "only the CTE body's own column");
}

#[test]
fn a_derived_table_is_not_judged() {
    let text = "SELECT x FROM (SELECT 1 AS y) t";
    assert!(columns(text).iter().all(|(name, _, judgeable)| name == "y" || !judgeable));
}

#[test]
fn a_scope_mixing_a_known_table_and_a_derived_one_is_not_judged() {
    // The column may belong to the half that cannot be seen.
    let text = "SELECT total FROM orders JOIN (SELECT 1 AS n) d ON true";
    let (_, _, judgeable) = columns(text).into_iter().find(|(name, _, _)| name == "total").unwrap();
    assert!(!judgeable);
}

#[test]
fn the_two_halves_of_a_union_are_scoped_separately() {
    // Each half sees only its own FROM clause, so a column of one is not excused by the other.
    let text = "SELECT a FROM orders UNION SELECT b FROM customers";
    assert_eq!(visible(text, "a"), ["orders"]);
    assert_eq!(visible(text, "b"), ["customers"]);
}

#[test]
fn a_subquery_in_a_where_clause_gets_its_own_scope() {
    let text = "SELECT total FROM orders WHERE cid IN (SELECT id FROM customers)";
    assert_eq!(visible(text, "total"), ["orders"]);
    assert_eq!(visible(text, "id"), ["customers"]);
}

#[test]
fn a_column_in_a_statement_naming_no_table_is_not_judged() {
    assert!(columns("SELECT some_column").iter().all(|(_, _, judgeable)| !judgeable));
}

#[test]
fn a_values_list_is_not_a_table() {
    assert!(tables("SELECT * FROM (VALUES (1), (2)) AS v(n)").is_empty());
}

#[test]
fn every_statement_in_a_document_is_analyzed() {
    // Each statement numbers its own scopes from zero, so this is also the check that they are
    // renumbered rather than colliding when the document's results are merged.
    assert_eq!(
        tables("SELECT a FROM orders;\nSELECT b FROM customers"),
        [("orders".to_string(), None), ("customers".to_string(), None)]
    );
    assert_eq!(visible("SELECT a FROM orders;\nSELECT b FROM customers", "a"), ["orders"]);
    assert_eq!(visible("SELECT a FROM orders;\nSELECT b FROM customers", "b"), ["customers"]);
}

#[test]
fn a_statement_that_does_not_parse_contributes_nothing_but_does_not_stop_the_others() {
    assert_eq!(
        tables("SELECT * FRM broken;\nSELECT a FROM orders"),
        [("orders".to_string(), None)]
    );
}

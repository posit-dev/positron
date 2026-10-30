/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

//! Statements carrying a ggsql `VISUALISE` part, which is not SQL and is left alone: the query in
//! front of it is analyzed as usual, and the part itself is neither reported nor completed.

mod support;

use serde_json::{json, Value};
use support::{analyze, cursor, diagnostics, request};

const PLOT: &str = "SELECT date, revenue FROM sales WHERE year = 2024\n\
                    VISUALISE date AS x, revenue AS y\n\
                    DRAW line\n\
                    LABEL title => 'Revenue'";

fn spans(text: &str) -> Vec<String> {
    request(json!({ "op": "statements", "text": text }))["statements"]
        .as_array()
        .unwrap()
        .iter()
        .map(|statement| support::slice(text, statement))
        .collect()
}

fn tables(response: &Value) -> Vec<String> {
    response["tables"]
        .as_array()
        .unwrap()
        .iter()
        .map(|table| table["name"].as_str().unwrap().to_string())
        .collect()
}

fn keywords_at(marked: &str) -> (usize, String) {
    let (text, offset) = cursor(marked);
    let response = request(json!({ "op": "keywordsAt", "text": text, "offset": offset }));
    (
        response["keywords"].as_array().unwrap().len(),
        response["position"].as_str().unwrap().to_string(),
    )
}

fn sources_at(marked: &str) -> (Vec<String>, String) {
    let (text, offset) = cursor(marked);
    let response = request(json!({ "op": "sources", "text": text, "offset": offset }));
    (
        response["sources"]
            .as_array()
            .unwrap()
            .iter()
            .map(|source| source["name"].as_str().unwrap().to_string())
            .collect(),
        response["origin"].as_str().unwrap().to_string(),
    )
}

#[test]
fn the_visualise_part_is_not_reported() {
    assert_eq!(diagnostics(PLOT), []);
}

#[test]
fn either_spelling_in_any_case_is_recognized() {
    assert_eq!(
        diagnostics("SELECT x, y FROM t VISUALIZE x, y DRAW point"),
        []
    );
    assert_eq!(
        diagnostics("SELECT x, y FROM t visualise x, y DRAW point"),
        []
    );
}

#[test]
fn the_query_in_front_of_it_is_still_analyzed() {
    assert_eq!(tables(&analyze(PLOT)), ["sales"]);
}

#[test]
fn an_error_in_the_query_in_front_of_it_is_still_reported() {
    assert_eq!(
        diagnostics("SELECT date FROM sales WHERE VISUALISE date AS x DRAW line"),
        [(
            "VISUALISE".to_string(),
            "Expected: an expression, found: VISUALISE.".to_string()
        )]
    );
}

#[test]
fn a_visualise_with_no_query_is_not_reported() {
    let text = "VISUALISE x, y FROM sales DRAW bar";
    assert_eq!(diagnostics(text), []);
    assert_eq!(tables(&analyze(text)), Vec::<String>::new());
}

#[test]
fn the_statement_still_spans_both_parts() {
    // Running it sends the query and its plot to ggsql together.
    assert_eq!(
        spans(&format!("{PLOT};\nSELECT 1")),
        [format!("{PLOT};"), "SELECT 1".to_string()]
    );
}

#[test]
fn only_the_statement_holding_it_is_affected() {
    assert_eq!(
        diagnostics("SELECT x FROM t VISUALISE x DRAW point; SELECT FROM"),
        [(
            "FROM".to_string(),
            "Expected: identifier, found: EOF.".to_string()
        )]
    );
}

#[test]
fn a_quoted_visualise_is_an_identifier() {
    assert_eq!(tables(&analyze(r#"SELECT "visualise" FROM t"#)), ["t"]);
    assert_eq!(diagnostics(r#"SELECT "visualise" FROM t"#), []);
}

#[test]
fn a_visualise_inside_parentheses_is_still_an_error() {
    assert_eq!(
        diagnostics("SELECT * FROM (SELECT x FROM t VISUALISE x DRAW point)").len(),
        1
    );
}

#[test]
fn no_keyword_is_offered_in_the_visualise_part() {
    assert_eq!(
        keywords_at("SELECT x FROM t VISUALISE x DRAW |"),
        (0, "visualise".to_string())
    );
    assert_eq!(
        keywords_at("SELECT x FROM t VISUALISE|"),
        (0, "visualise".to_string())
    );
}

#[test]
fn the_query_in_front_of_it_still_completes_as_sql() {
    let (count, position) = keywords_at("SELECT x FROM t |VISUALISE x DRAW point");
    assert_ne!(position, "visualise");
    assert!(count > 0);
}

#[test]
fn no_source_is_offered_in_the_visualise_part() {
    assert_eq!(
        sources_at("SELECT x FROM t VISUALISE | DRAW point"),
        (Vec::new(), "visualise".to_string())
    );
}

#[test]
fn the_query_in_front_of_it_still_sees_its_tables() {
    assert_eq!(
        sources_at("SELECT | FROM t VISUALISE x DRAW point").0,
        ["t"]
    );
}

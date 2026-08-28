/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

//! Splitting a document into statements, which the statement range provider runs on.

mod support;

use serde_json::{json, Value};
use support::request;

/// The statements of a document, as the text of each and whether it was terminated.
fn split(text: &str) -> Vec<(String, bool)> {
    let response = request(json!({ "op": "statements", "text": text }));
    statements(&response, text)
}

fn statements(response: &Value, text: &str) -> Vec<(String, bool)> {
    response["statements"]
        .as_array()
        .expect("statements are an array")
        .iter()
        .map(|statement| {
            (support::slice(text, statement), statement["terminated"].as_bool().unwrap_or(false))
        })
        .collect()
}

#[test]
fn splits_on_top_level_semicolons() {
    assert_eq!(
        split("SELECT 1; SELECT 2;"),
        [("SELECT 1;".into(), true), ("SELECT 2;".into(), true)]
    );
}

#[test]
fn a_final_statement_without_a_semicolon_is_unterminated() {
    assert_eq!(
        split("SELECT 1; SELECT 2"),
        [("SELECT 1;".into(), true), ("SELECT 2".into(), false)]
    );
}

#[test]
fn a_semicolon_inside_a_literal_does_not_split() {
    assert_eq!(split("SELECT 'a;b'"), [("SELECT 'a;b'".into(), false)]);
}

#[test]
fn a_semicolon_inside_a_dollar_quoted_body_does_not_split() {
    let text = "CREATE FUNCTION f() RETURNS int AS $$ BEGIN RETURN 1; END $$ LANGUAGE plpgsql";
    assert_eq!(
        request(json!({ "op": "statements", "dialect": "postgres", "text": text }))["statements"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn a_semicolon_inside_a_comment_does_not_split() {
    assert_eq!(split("SELECT 1 -- a; b\n+ 2"), [("SELECT 1 -- a; b\n+ 2".into(), false)]);
}

#[test]
fn comments_and_whitespace_alone_yield_no_statements() {
    assert!(split("-- just a comment\n\n  /* and a block */\n").is_empty());
    assert!(split("").is_empty());
    assert!(split("   \n\t ").is_empty());
}

#[test]
fn empty_runs_between_semicolons_are_dropped() {
    assert_eq!(
        split("SELECT 1;;;SELECT 2;"),
        [("SELECT 1;".into(), true), ("SELECT 2;".into(), true)]
    );
}

#[test]
fn a_statement_ends_at_its_semicolon_not_at_the_whitespace_after_it() {
    // The range the user's cursor is sent with, so a trailing newline must not be part of it.
    assert_eq!(split("SELECT 1;\n\n"), [("SELECT 1;".into(), true)]);
}

#[test]
fn a_trailing_comment_is_not_swallowed_by_the_statement_above_it() {
    assert_eq!(split("SELECT 1;\n-- afterwards"), [("SELECT 1;".into(), true)]);
}

#[test]
fn statements_are_still_split_around_an_unterminated_literal() {
    // The quote is closed at the end of its line, so the statement holding it is whole rather
    // than cut off where the tokenizer stopped.
    assert_eq!(
        split("SELECT 1;\nSELECT 'oops"),
        [("SELECT 1;".into(), true), ("SELECT 'oops".into(), false)]
    );
}

#[test]
fn an_unterminated_quote_does_not_swallow_the_statements_below_it() {
    // The whole point of closing it. Before, the stray quote ran to the end of the file and took
    // every statement below it; now it ends with the line it was typed on, and the ranges below
    // are the ranges they would have been. These are sliced out of the original text by the
    // offsets the analyzer reported, so text added to close the quote shifting anything under it
    // would show up here as well.
    assert_eq!(
        split("SELECT *\nFROM t\nWHERE a = 'oops\n  AND b = 1;\nSELECT 2;\nSELECT 3;"),
        [
            ("SELECT *\nFROM t\nWHERE a = 'oops\n  AND b = 1;".into(), true),
            ("SELECT 2;".into(), true),
            ("SELECT 3;".into(), true),
        ]
    );
}

#[test]
fn a_semicolon_the_stray_quote_had_swallowed_stays_swallowed() {
    // Closing the quote at the end of its line, rather than before the semicolon on it, is what
    // keeps this from inventing a statement boundary the author did not write. The two statements
    // still run together, which is what the text says; what is recovered is everything below.
    assert_eq!(
        split("SELECT 'oops;\nSELECT 2;\nSELECT 3;"),
        [("SELECT 'oops;\nSELECT 2;".into(), true), ("SELECT 3;".into(), true)]
    );
}

#[test]
fn an_unterminated_block_comment_still_runs_to_the_end_of_the_document() {
    // The other way round from a quote, and deliberately: a block comment is written across lines
    // on purpose, so ending it at the first newline would resurrect the text the author was in
    // the middle of commenting out and bury it in diagnostics.
    assert_eq!(split("SELECT 1;\n/* SELECT 2;\nSELECT 3;"), [("SELECT 1;".into(), true)]);
}

#[test]
fn an_unterminated_dollar_quoted_body_still_runs_to_the_end_of_the_document() {
    // Multi-line by construction, like a block comment, so it is closed the same way.
    let text = "SELECT 1;\nSELECT $tag$ oops;\nSELECT 3;";
    let response = request(json!({ "op": "statements", "dialect": "postgres", "text": text }));
    assert_eq!(
        statements(&response, text),
        [("SELECT 1;".into(), true), ("SELECT $tag$ oops;\nSELECT 3;".into(), false)]
    );
}

#[test]
fn offsets_are_counted_in_utf16_units() {
    // The emoji is one Unicode scalar value and two UTF-16 units; an editor counts the latter.
    let text = "SELECT '\u{1F600}';\nSELECT 2";
    let response = request(json!({ "op": "statements", "text": text }));
    assert_eq!(
        statements(&response, text),
        [("SELECT '\u{1F600}';".into(), true), ("SELECT 2".into(), false)]
    );
}

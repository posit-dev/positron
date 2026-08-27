/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

//! Syntax diagnostics: what is reported, and where the squiggle lands.

mod support;

use support::{analyze_as, diagnostics, diagnostics_of};

#[test]
fn valid_sql_has_no_diagnostics() {
    assert!(diagnostics("SELECT id, name FROM customers WHERE id > 10 ORDER BY name").is_empty());
}

#[test]
fn an_empty_document_has_no_diagnostics() {
    assert!(diagnostics("").is_empty());
    assert!(diagnostics("   \n  ").is_empty());
}

#[test]
fn comments_alone_have_no_diagnostics() {
    assert!(diagnostics("-- a comment\n/* and a block one */").is_empty());
}

#[test]
fn the_range_covers_the_offending_token() {
    assert_eq!(
        diagnostics("SELECT * FRM customers"),
        [("FRM".to_string(), "Expected: end of statement, found: FRM.".to_string())]
    );
}

#[test]
fn each_statement_is_reported_independently() {
    // The point of splitting first: an error in the middle statement must not cost the last one
    // its own report, which is what parsing the document as a whole would do.
    assert_eq!(
        diagnostics("SELECT * FRM a;\nSELECT 1;\nSELECT * FRM b"),
        [
            ("FRM".to_string(), "Expected: end of statement, found: FRM.".to_string()),
            ("FRM".to_string(), "Expected: end of statement, found: FRM.".to_string()),
        ]
    );
}

#[test]
fn only_one_diagnostic_is_reported_per_statement() {
    // Past the first, errors in one statement are cascades of it, and every extra squiggle is one
    // the user has to read past to find the real problem.
    assert_eq!(diagnostics("SELECT * FRM a WHRE x ==== 1").len(), 1);
}

#[test]
fn positions_are_correct_on_later_lines() {
    let text = "SELECT 1;\n\nSELECT 2;\nSELECT * FRM t";
    assert_eq!(diagnostics(text), [("FRM".to_string(), "Expected: end of statement, found: FRM.".to_string())]);
}

#[test]
fn an_unterminated_string_is_reported_at_the_string() {
    let text = "SELECT 1;\nSELECT 'oops";
    let reported = diagnostics(text);
    assert_eq!(reported.len(), 1, "one report, not one per statement after it");
    assert_eq!(reported[0].1, "Unterminated string literal.");
    assert_eq!(reported[0].0, "'oops", "the squiggle covers the literal that never closed");
}

#[test]
fn an_unterminated_block_comment_is_reported_at_the_comment() {
    let reported = diagnostics("SELECT 1;\n/* never closed");
    assert_eq!(reported.len(), 1);
    assert!(reported[0].1.to_lowercase().contains("comment"), "got {:?}", reported[0].1);
}

#[test]
fn messages_do_not_leak_internal_positions() {
    // The position is already the position of the squiggle; repeating it reads like debug output.
    for (_, message) in diagnostics("SELECT * FRM t") {
        assert!(!message.contains("at Line:"), "got {message:?}");
    }
}

#[test]
fn the_dialect_decides_what_is_an_error() {
    // A backtick quotes an identifier in MySQL and means nothing in PostgreSQL.
    let text = "SELECT `total` FROM orders";
    assert!(diagnostics_of(&analyze_as("mysql", text), text).is_empty());
    assert!(!diagnostics_of(&analyze_as("postgres", text), text).is_empty());
}

#[test]
fn an_unknown_dialect_falls_back_rather_than_failing_the_request() {
    // The setting is a plain string in settings.json, so a typo is reachable and must not leave
    // the file with no diagnostics at all.
    let text = "SELECT * FRM t";
    assert_eq!(diagnostics_of(&analyze_as("not-a-dialect", text), text).len(), 1);
}

#[test]
fn the_generic_dialect_accepts_ordinary_sql() {
    for text in [
        "SELECT a, b FROM t JOIN u ON t.id = u.id",
        "WITH x AS (SELECT 1 AS n) SELECT n FROM x",
        "INSERT INTO t (a, b) VALUES (1, 2)",
        "UPDATE t SET a = 1 WHERE b = 2",
        "DELETE FROM t WHERE a = 1",
        "CREATE TABLE t (a int, b text)",
    ] {
        assert!(diagnostics(text).is_empty(), "{text:?} should parse: {:?}", diagnostics(text));
    }
}

#[test]
fn diagnostic_ranges_stay_inside_the_document() {
    // An error at end of input has no token to point at, so it falls back to the statement.
    let text = "SELECT a FROM t WHERE";
    let response = support::analyze(text);
    let length = text.encode_utf16().count() as u64;
    for diagnostic in response["diagnostics"].as_array().unwrap() {
        let start = diagnostic["start"].as_u64().unwrap();
        let end = diagnostic["end"].as_u64().unwrap();
        assert!(start <= end && end <= length, "{start}..{end} is outside 0..{length}");
    }
}

#[test]
fn an_error_at_end_of_input_squiggles_the_unfinished_statement() {
    assert_eq!(
        diagnostics("SELECT a FROM t WHERE"),
        [(
            "SELECT a FROM t WHERE".to_string(),
            "Expected: an expression, found: EOF.".to_string()
        )]
    );
}

#[test]
fn ranges_are_counted_in_utf16_units() {
    // Everything after the emoji shifts by two units rather than one, which is the whole reason
    // positions are converted inside the analyzer rather than on the other side of the boundary.
    assert_eq!(
        diagnostics("SELECT '\u{1F600}' FROM t GROUP"),
        [("GROUP".to_string(), "Expected: end of statement, found: GROUP.".to_string())]
    );
}

#[test]
fn deep_nesting_is_refused_rather_than_crashing() {
    // A generated query really can nest this far, and overflowing the stack would trap the whole
    // module rather than failing one request.
    let text = format!("SELECT {}1{}", "(".repeat(400), ")".repeat(400));
    assert_eq!(diagnostics(&text).len(), 1);
    assert!(diagnostics(&text)[0].1.contains("too deeply"));
}

#[test]
fn a_dialect_renamed_since_the_setting_was_written_still_resolves() {
    // A user who picked `tsql` from the settings list meant Transact-SQL. sqlparser spells it
    // `mssql`, and falling back to generic would quietly stop honouring their choice.
    let text = "SELECT TOP 5 [total] FROM [orders]";
    assert!(diagnostics_of(&analyze_as("tsql", text), text).is_empty());
    assert_eq!(analyze_as("tsql", text)["unknownDialect"], false);
    assert_eq!(analyze_as("spark2", text)["unknownDialect"], false);
}

#[test]
fn an_unrecognized_dialect_says_so() {
    // So the caller can tell the user, rather than leave them wondering why their dialect's
    // syntax is being flagged.
    assert_eq!(analyze_as("not-a-dialect", "SELECT 1")["unknownDialect"], true);
    assert_eq!(analyze_as("postgres", "SELECT 1")["unknownDialect"], false);
    assert_eq!(analyze_as("", "SELECT 1")["unknownDialect"], false);
}

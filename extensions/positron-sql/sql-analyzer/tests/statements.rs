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

/// The statements of a document in a dialect.
fn split_in(dialect: &str, text: &str) -> Vec<(String, bool)> {
    let response = request(json!({ "op": "statements", "dialect": dialect, "text": text }));
    statements(&response, text)
}

/// The text of each statement of a document in a dialect, without whether it was terminated.
fn texts_in(dialect: &str, text: &str) -> Vec<String> {
    split_in(dialect, text)
        .into_iter()
        .map(|(text, _)| text)
        .collect()
}

fn statements(response: &Value, text: &str) -> Vec<(String, bool)> {
    response["statements"]
        .as_array()
        .expect("statements are an array")
        .iter()
        .map(|statement| {
            (
                support::slice(text, statement),
                statement["terminated"].as_bool().unwrap_or(false),
            )
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
    assert_eq!(
        split("SELECT 1 -- a; b\n+ 2"),
        [("SELECT 1 -- a; b\n+ 2".into(), false)]
    );
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
    assert_eq!(
        split("SELECT 1;\n-- afterwards"),
        [("SELECT 1;".into(), true)]
    );
}

#[test]
fn a_trailing_comment_is_not_swallowed_by_an_unterminated_statement_above_it() {
    // The range is what Cmd+Enter sends to the console, so the comment lines below must not ride
    // along with it.
    assert_eq!(
        split("SELECT 1\n-- afterwards\n"),
        [("SELECT 1".into(), false)]
    );
    assert_eq!(split("SELECT 1 /* note */"), [("SELECT 1".into(), false)]);
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
            (
                "SELECT *\nFROM t\nWHERE a = 'oops\n  AND b = 1;".into(),
                true
            ),
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
        [
            ("SELECT 'oops;\nSELECT 2;".into(), true),
            ("SELECT 3;".into(), true)
        ]
    );
}

#[test]
fn an_unterminated_block_comment_still_runs_to_the_end_of_the_document() {
    // The other way round from a quote, and deliberately: a block comment is written across lines
    // on purpose, so ending it at the first newline would resurrect the text the author was in
    // the middle of commenting out and bury it in diagnostics.
    assert_eq!(
        split("SELECT 1;\n/* SELECT 2;\nSELECT 3;"),
        [("SELECT 1;".into(), true)]
    );
}

#[test]
fn an_unterminated_dollar_quoted_body_still_runs_to_the_end_of_the_document() {
    // Multi-line by construction, like a block comment, so it is closed the same way.
    let text = "SELECT 1;\nSELECT $tag$ oops;\nSELECT 3;";
    let response = request(json!({ "op": "statements", "dialect": "postgres", "text": text }));
    assert_eq!(
        statements(&response, text),
        [
            ("SELECT 1;".into(), true),
            ("SELECT $tag$ oops;\nSELECT 3;".into(), false)
        ]
    );
}

#[test]
fn offsets_are_counted_in_utf16_units() {
    // The emoji is one Unicode scalar value and two UTF-16 units; an editor counts the latter.
    let text = "SELECT '\u{1F600}';\nSELECT 2";
    let response = request(json!({ "op": "statements", "text": text }));
    assert_eq!(
        statements(&response, text),
        [
            ("SELECT '\u{1F600}';".into(), true),
            ("SELECT 2".into(), false)
        ]
    );
}

#[test]
fn a_trigger_body_is_not_split_at_its_own_semicolons() {
    let text = "CREATE TRIGGER t AFTER INSERT ON a BEGIN UPDATE b SET n = 1; DELETE FROM c; END;\nSELECT 1;";
    assert_eq!(
        split(text),
        [
            (
                "CREATE TRIGGER t AFTER INSERT ON a BEGIN UPDATE b SET n = 1; DELETE FROM c; END;"
                    .into(),
                true
            ),
            ("SELECT 1;".into(), true)
        ]
    );
}

#[test]
fn a_case_and_an_end_if_inside_a_routine_body_do_not_end_it_early() {
    let text = "CREATE PROCEDURE p() BEGIN IF x THEN SELECT CASE WHEN a THEN 1 END; END IF; END;\nSELECT 2;";
    assert_eq!(split(text).len(), 2);
    assert_eq!(split(text)[1], ("SELECT 2;".into(), true));
}

#[test]
fn a_transaction_begin_is_still_its_own_statement() {
    assert_eq!(
        split("BEGIN; SELECT 1; COMMIT;"),
        [
            ("BEGIN;".into(), true),
            ("SELECT 1;".into(), true),
            ("COMMIT;".into(), true)
        ]
    );
    // A column called `begin` in a CREATE TABLE is a name, not a block.
    assert_eq!(split("CREATE TABLE t (begin INT); SELECT 1;").len(), 2);
}

#[test]
fn a_transaction_inside_a_procedure_does_not_hold_the_procedure_open() {
    // `BEGIN TRANSACTION` has no `END`. Counting it as a block left the procedure open, and
    // every statement below it ran with it.
    let text = "CREATE PROCEDURE reset_balances AS\nBEGIN\n  BEGIN TRANSACTION;\n  UPDATE accounts SET balance = 0;\n  COMMIT TRANSACTION;\nEND;\n\nSELECT 'after' AS marker;\nDELETE FROM accounts;";
    assert_eq!(
        texts_in("tsql", text),
        [
            "CREATE PROCEDURE reset_balances AS\nBEGIN\n  BEGIN TRANSACTION;\n  UPDATE accounts SET balance = 0;\n  COMMIT TRANSACTION;\nEND;",
            "SELECT 'after' AS marker;",
            "DELETE FROM accounts;",
        ]
    );
    assert_eq!(
        split("CREATE PROCEDURE p() BEGIN BEGIN TRAN; COMMIT; END;\nSELECT 1;").len(),
        2
    );
}

#[test]
fn an_end_followed_by_an_if_statement_closes_its_block() {
    // T-SQL has no `END IF`: the `IF` on the line after a block's `END` starts the next
    // statement of the body.
    let text = "CREATE PROCEDURE check_flags @a INT, @b INT AS\nBEGIN\n  IF @a = 1\n  BEGIN\n    SELECT 1;\n  END\n  IF @b = 1\n  BEGIN\n    SELECT 2;\n  END\nEND;\n\nSELECT 'after' AS marker;\nDELETE FROM accounts;";
    let texts = texts_in("tsql", text);
    assert_eq!(texts.len(), 3, "{texts:?}");
    assert_eq!(texts[1], "SELECT 'after' AS marker;");
    // The generic dialect reads it the same way.
    assert_eq!(texts_in("", text), texts);
}

#[test]
fn a_block_under_control_flow_outside_a_routine_is_one_statement() {
    let text = "IF @x = 1 BEGIN SELECT 1; SELECT 2; END ELSE BEGIN SELECT 3; END;\nWHILE @n < 3 BEGIN SET @n = @n + 1; END;\nIF @y = 1 SELECT 4;\nSELECT 5;";
    assert_eq!(
        texts_in("tsql", text),
        [
            "IF @x = 1 BEGIN SELECT 1; SELECT 2; END ELSE BEGIN SELECT 3; END;",
            "WHILE @n < 3 BEGIN SET @n = @n + 1; END;",
            "IF @y = 1 SELECT 4;",
            "SELECT 5;",
        ]
    );
}

#[test]
fn an_end_loop_with_a_label_still_closes_only_its_loop() {
    let text =
        "CREATE PROCEDURE p() BEGIN outer: LOOP LEAVE outer; END LOOP outer; END;\nSELECT 1;";
    assert_eq!(split(text).len(), 2);
}

#[test]
fn an_anonymous_block_is_one_statement() {
    let text = "BEGIN\n  INSERT INTO log VALUES (1);\n  INSERT INTO log VALUES (2);\nEND;\n\nSELECT * FROM log;";
    let expected = [
        "BEGIN\n  INSERT INTO log VALUES (1);\n  INSERT INTO log VALUES (2);\nEND;",
        "SELECT * FROM log;",
    ];
    assert_eq!(texts_in("oracle", text), expected);
    // T-SQL runs them too, and writes TRY and CATCH as blocks.
    assert_eq!(texts_in("tsql", text), expected);
    assert_eq!(
        texts_in(
            "tsql",
            "BEGIN TRY SELECT 1; END TRY BEGIN CATCH SELECT 2; END CATCH;\nSELECT 3;"
        ),
        [
            "BEGIN TRY SELECT 1; END TRY BEGIN CATCH SELECT 2; END CATCH;",
            "SELECT 3;"
        ]
    );
}

#[test]
fn a_declare_section_belongs_to_the_block_after_it() {
    let text = "DECLARE\n  n NUMBER;\nBEGIN\n  n := 1;\nEND;\nSELECT 1 FROM dual;";
    assert_eq!(
        texts_in("oracle", text),
        [
            "DECLARE\n  n NUMBER;\nBEGIN\n  n := 1;\nEND;",
            "SELECT 1 FROM dual;"
        ]
    );
    // Elsewhere a DECLARE is a statement of its own.
    assert_eq!(
        texts_in("tsql", "DECLARE @n INT;\nSELECT @n;"),
        ["DECLARE @n INT;", "SELECT @n;"]
    );
}

#[test]
fn a_plsql_routine_keeps_its_declarations() {
    let text = "CREATE OR REPLACE PROCEDURE p IS\n  n NUMBER;\nBEGIN\n  IF n IS NULL THEN n := 1; END IF;\nEND p;\nSELECT 1 FROM dual;";
    assert_eq!(texts_in("oracle", text).len(), 2);
    // A package's routines each have declarations and a body of their own.
    let text = "CREATE PACKAGE BODY k AS\n  PROCEDURE a IS BEGIN NULL; END a;\n  FUNCTION b RETURN NUMBER IS BEGIN RETURN 1; END b;\nEND k;\nSELECT 1 FROM dual;";
    assert_eq!(texts_in("oracle", text).len(), 2);
}

#[test]
fn an_event_body_is_not_split_at_its_own_semicolons() {
    let text = "CREATE EVENT nightly\nON SCHEDULE EVERY 1 DAY\nDO\nBEGIN\n  DELETE FROM sessions WHERE expired = 1;\n  UPDATE stats SET runs = runs + 1;\nEND;\n\nSELECT 'after event' AS marker;";
    assert_eq!(
        texts_in("mysql", text)[1],
        "SELECT 'after event' AS marker;"
    );
}

#[test]
fn a_definer_does_not_hide_the_routine_it_defines() {
    let text =
        "CREATE DEFINER = CURRENT_USER() PROCEDURE p() BEGIN SELECT 1; SELECT 2; END;\nSELECT 3;";
    assert_eq!(texts_in("mysql", text).len(), 2);
}

#[test]
fn a_column_named_like_a_routine_does_not_make_a_routine() {
    assert_eq!(
        split("CREATE TABLE schedule (function TEXT, begin DATE, finish DATE);\nSELECT * FROM schedule;\nSELECT 99;").len(),
        3
    );
}

#[test]
fn a_block_left_open_costs_only_its_own_statement() {
    // A procedure still being typed, or one whose blocks were misread: it splits on its
    // semicolons, and the statements below it are their own again.
    assert_eq!(
        texts_in(
            "mysql",
            "CREATE PROCEDURE p() BEGIN SELECT 1; SELECT 2;\nSELECT 3;"
        ),
        [
            "CREATE PROCEDURE p() BEGIN SELECT 1;",
            "SELECT 2;",
            "SELECT 3;"
        ]
    );
    // A block after it is still read as one.
    assert_eq!(
        texts_in("mysql", "CREATE PROCEDURE p() BEGIN SELECT 1;\nCREATE PROCEDURE q() BEGIN SELECT 2; END;\nSELECT 3;"),
        ["CREATE PROCEDURE p() BEGIN SELECT 1;", "CREATE PROCEDURE q() BEGIN SELECT 2; END;", "SELECT 3;"]
    );
}

#[test]
fn an_unterminated_bracketed_identifier_does_not_swallow_the_statements_below_it() {
    // Closed at the end of its line, like a quote, so what is below it is SQL again.
    let text = "SELECT [order date\nFROM t;\nSELECT 2;\nSELECT 3;";
    let expected = ["SELECT [order date\nFROM t;", "SELECT 2;", "SELECT 3;"];
    assert_eq!(texts_in("tsql", text), expected);
    assert_eq!(texts_in("sqlite", text), expected);
    // Not mistaken for a quote it holds, which would close nothing.
    assert_eq!(
        texts_in("tsql", "SELECT [it's\nFROM t;\nSELECT 2;"),
        ["SELECT [it's\nFROM t;", "SELECT 2;"]
    );
}

/// Each statement of a document in a dialect, with the rest of its line that still counts as
/// being at it: the text up to its `trailingEnd`.
fn trailing_in(dialect: &str, text: &str) -> Vec<String> {
    let response = request(json!({ "op": "statements", "dialect": dialect, "text": text }));
    let units: Vec<u16> = text.encode_utf16().collect();
    response["statements"]
        .as_array()
        .expect("statements are an array")
        .iter()
        .map(|statement| {
            let start = statement["start"].as_u64().unwrap() as usize;
            let end = statement["trailingEnd"].as_u64().unwrap() as usize;
            String::from_utf16(&units[start..end]).unwrap()
        })
        .collect()
}

#[test]
fn the_rest_of_a_line_after_a_statement_is_spaces_and_comments_up_to_the_line_break() {
    assert_eq!(
        trailing_in("", "SELECT 1; -- note\nSELECT 2;"),
        ["SELECT 1; -- note", "SELECT 2;"]
    );
    assert_eq!(
        trailing_in("", "SELECT 1; /* a */ -- b\nSELECT 2;"),
        ["SELECT 1; /* a */ -- b", "SELECT 2;"]
    );
    // A statement after it on the same line has the rest of the line, so a cursor at its start
    // runs it rather than the one before.
    assert_eq!(
        trailing_in("", "SELECT 1;  SELECT 2;"),
        ["SELECT 1;", "SELECT 2;"]
    );
    assert_eq!(
        trailing_in("", "SELECT 1; /* a */ SELECT 2;"),
        ["SELECT 1;", "SELECT 2;"]
    );
    // A block comment that runs on to later lines leads up to the next statement instead.
    assert_eq!(
        trailing_in("", "SELECT 1; /* a\n b */ SELECT 2;"),
        ["SELECT 1; ", "SELECT 2;"]
    );
    // An unterminated statement has a rest of its line too.
    assert_eq!(trailing_in("", "SELECT 1 -- note\n"), ["SELECT 1 -- note"]);
}

#[test]
fn the_rest_of_a_line_ends_before_a_carriage_return() {
    // PostgreSQL's tokenizer ends a line comment at the carriage return, the others at the
    // line feed with the carriage return kept in the comment; neither belongs to the line.
    for dialect in ["", "postgres"] {
        assert_eq!(
            trailing_in(dialect, "SELECT 1; -- note\r\nSELECT 2;"),
            ["SELECT 1; -- note", "SELECT 2;"],
            "{dialect}"
        );
    }
}

#[test]
fn a_hash_comment_is_the_rest_of_the_line_where_the_dialect_comments_with_it() {
    assert_eq!(
        trailing_in("mysql", "SELECT `a;b` FROM t; # comment ; here\nSELECT 2;"),
        ["SELECT `a;b` FROM t; # comment ; here", "SELECT 2;"]
    );
}

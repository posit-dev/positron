/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

//! The keyword lists completion offers, and where each one belongs.
//!
//! Every case is SQL halfway through being typed, because that is the state a document is in
//! whenever completion is asked for.

mod support;

use serde_json::json;
use support::{cursor, request};

fn keywords() -> Vec<String> {
    request(json!({ "op": "keywords" }))["keywords"]
        .as_array()
        .unwrap()
        .iter()
        .map(|keyword| keyword.as_str().unwrap().to_string())
        .collect()
}

/// The keywords offered at the cursor, written as `|`, and the position the scan decided on.
fn at_cursor(marked: &str) -> (Vec<String>, String) {
    at_cursor_as("", marked)
}

fn at_cursor_as(dialect: &str, marked: &str) -> (Vec<String>, String) {
    let (text, offset) = cursor(marked);
    let response =
        request(json!({ "op": "keywordsAt", "text": text, "dialect": dialect, "offset": offset }));
    (
        response["keywords"]
            .as_array()
            .unwrap()
            .iter()
            .map(|keyword| keyword.as_str().unwrap().to_string())
            .collect(),
        response["position"].as_str().unwrap().to_string(),
    )
}

fn offered(marked: &str) -> Vec<String> {
    at_cursor(marked).0
}

fn position(marked: &str) -> String {
    at_cursor(marked).1
}

/// Asserts that every one of `present` is offered and none of `absent` is.
fn expect(marked: &str, present: &[&str], absent: &[&str]) {
    let keywords = offered(marked);
    let missing: Vec<&&str> = present
        .iter()
        .filter(|k| !keywords.iter().any(|o| o == **k))
        .collect();
    let unwanted: Vec<&&str> = absent
        .iter()
        .filter(|k| keywords.iter().any(|o| o == **k))
        .collect();
    assert_eq!(
        (missing, unwanted),
        (Vec::new(), Vec::new()),
        "at {marked:?} (position {}), which offered {keywords:?}",
        position(marked)
    );
}

#[test]
fn the_ordinary_keywords_are_offered() {
    let keywords = keywords();
    for expected in ["SELECT", "FROM", "WHERE", "JOIN", "INSERT", "DISTINCT"] {
        assert!(
            keywords.iter().any(|keyword| keyword == expected),
            "missing {expected}"
        );
    }
}

#[test]
fn multi_word_keywords_are_offered_whole() {
    // sqlparser tokenizes each word separately and has no notion of a phrase, so these are ours.
    let keywords = keywords();
    for expected in ["GROUP BY", "ORDER BY", "LEFT OUTER JOIN", "UNION ALL"] {
        assert!(
            keywords.iter().any(|keyword| keyword == expected),
            "missing {expected}"
        );
    }
}

#[test]
fn operators_are_not_offered_as_keywords() {
    // Nobody completes `!=` or `#>>` by name, and a list full of punctuation buries the words.
    // `END-EXEC` is the one hyphenated keyword the standard has, and is a word.
    for keyword in keywords() {
        assert!(
            keyword.starts_with(|character: char| character.is_ascii_uppercase()),
            "{keyword:?} does not start with a letter"
        );
        assert!(
            keyword
                .chars()
                .any(|character| character.is_ascii_uppercase()),
            "{keyword:?} is punctuation rather than a word"
        );
    }
}

#[test]
fn the_list_is_sorted_and_has_no_duplicates() {
    // The caller offers it as-is, and a duplicate would show as two identical completions.
    let keywords = keywords();
    let mut sorted = keywords.clone();
    sorted.sort();
    sorted.dedup();
    assert_eq!(keywords, sorted);
}

/// Every position the scan is meant to recognize, as `(the cursor, the position it is)`.
///
/// A table rather than a test each, because what is being pinned is that the whole set is
/// reachable -- a position no text classifies as is a rule that never fires.
const POSITIONS: &[(&str, &str)] = &[
    ("|", "statementStart"),
    ("SELECT a FROM orders;\n|", "statementStart"),
    ("WITH c AS (SELECT 1) |", "statementStart"),
    ("CREATE |", "ddl"),
    ("SELECT |", "selectStart"),
    ("SELECT DISTINCT |", "selectStart"),
    ("SELECT total |", "selectItem"),
    ("SELECT * FROM |", "name"),
    ("SELECT a AS |", "identifier"),
    ("INSERT INTO orders (|", "identifier"),
    ("DROP TABLE |", "objectName"),
    ("SELECT * FROM orders |", "tableItem"),
    ("SELECT * FROM a JOIN b |", "joinedItem"),
    ("UPDATE orders |", "updateItem"),
    ("INSERT INTO orders |", "insertTarget"),
    ("SELECT * FROM orders WHERE |", "value"),
    ("SELECT * FROM orders WHERE id IN (|", "subquery"),
    ("SELECT * FROM orders WHERE id = 1 |", "expression"),
    ("SELECT * FROM a JOIN b ON a.id = b.id |", "joinCondition"),
    ("SELECT * FROM a JOIN b USING (id) |", "joinCondition"),
    ("SELECT * FROM orders ORDER BY id |", "orderItem"),
    ("SELECT row_number() OVER (|", "windowSpec"),
    ("CREATE TABLE orders (id |", "columnDefinition"),
    ("SELECT CAST(x AS |", "columnDefinition"),
    ("SELECT * FROM orders GROUP |", "expectingBy"),
    ("SELECT * FROM orders LEFT |", "expectingJoin"),
    (
        "SELECT * FROM orders ORDER BY id NULLS |",
        "expectingNullsOrder",
    ),
    ("SELECT * FROM orders WHERE a IS |", "expectingIsPredicate"),
    ("SELECT a FROM orders UNION |", "setOperand"),
    ("UPDATE orders SET a = 1 |", "assignment"),
    ("INSERT INTO orders VALUES (1) |", "valuesRow"),
    ("SELECT * FROM orders LIMIT |", "rowCount"),
];

#[test]
fn every_way_of_writing_a_row_count_is_one_position() {
    let cases = [
        "SELECT * FROM orders ORDER BY id LIMIT |",
        "SELECT * FROM orders LIMIT 10 OFFSET |",
        "SELECT * FROM orders LIMIT 10, |",
        "SELECT TOP |",
        "SELECT * FROM orders OFFSET 5 ROWS FETCH FIRST |",
        "SELECT * FROM orders OFFSET 5 ROWS FETCH NEXT |",
    ];
    let found: Vec<(&str, String)> = cases
        .iter()
        .map(|marked| (*marked, position(marked)))
        .collect();
    let expected: Vec<(&str, String)> = cases
        .iter()
        .map(|marked| (*marked, "rowCount".to_string()))
        .collect();
    assert_eq!(found, expected);
}

#[test]
fn a_row_count_offers_no_keyword_in_any_dialect() {
    // `LIMIT ALL` is PostgreSQL's alone, and a syntax error in MySQL; the parser accepts it in
    // both, so it cannot be offered in one and not the other.
    for dialect in ["", "mysql", "postgres"] {
        assert_eq!(
            at_cursor_as(dialect, "SELECT * FROM orders LIMIT |").0,
            Vec::<String>::new(),
            "{dialect}"
        );
    }
}

#[test]
fn what_follows_a_row_count_is_not_a_row_count() {
    // The count itself finishes the clause: `LIMIT 10 |` goes on to `OFFSET`, and the `FIRST` of
    // `NULLS FIRST` is an ordering, not a `FETCH`.
    assert_eq!(position("SELECT * FROM orders LIMIT 10 |"), "expression");
    assert_eq!(
        position("SELECT * FROM orders ORDER BY id NULLS FIRST |"),
        "orderItem"
    );
    assert_eq!(position("SELECT * FROM orders WHERE id IN (1, |"), "value");
}

#[test]
fn the_position_of_the_cursor_is_recognized() {
    let found: Vec<(&str, String)> = POSITIONS
        .iter()
        .map(|(marked, _)| (*marked, position(marked)))
        .collect();
    let expected: Vec<(&str, String)> = POSITIONS
        .iter()
        .map(|(marked, name)| (*marked, (*name).to_string()))
        .collect();
    assert_eq!(found, expected);
}

#[test]
fn a_ddl_modifier_only_counts_inside_a_ddl_statement() {
    // `OR`, `TEMP` and `UNIQUE` modify a CREATE, but elsewhere `OR` is a connective and `temp` or
    // `unique` is a column, and offering `DATABASE` or `INDEX` after them is nonsense.
    let found: Vec<(&str, String)> = [
        "CREATE OR |",
        "CREATE TEMP |",
        "SELECT * FROM orders WHERE a = 1 OR |",
        "SELECT temp |",
        "SELECT * FROM orders WHERE unique |",
    ]
    .iter()
    .map(|marked| (*marked, position(marked)))
    .collect();
    assert_eq!(
        found,
        [
            ("CREATE OR |", "ddl".to_string()),
            ("CREATE TEMP |", "ddl".to_string()),
            ("SELECT * FROM orders WHERE a = 1 OR |", "value".to_string()),
            ("SELECT temp |", "selectItem".to_string()),
            (
                "SELECT * FROM orders WHERE unique |",
                "expression".to_string()
            ),
        ]
    );
}

#[test]
fn a_finished_join_condition_offers_the_next_join_and_the_where() {
    // An expression in a `WHERE` is followed by neither, so the two are told apart by the clause:
    // after `ON` the FROM list is still being written.
    expect(
        "SELECT * FROM a JOIN b ON a.id = b.id |",
        &[
            "WHERE",
            "JOIN",
            "LEFT JOIN",
            "INNER JOIN",
            "ORDER BY",
            "AND",
        ],
        &[],
    );
    expect(
        "SELECT * FROM a WHERE a.id = 1 |",
        &["AND", "ORDER BY"],
        &["WHERE", "JOIN"],
    );
}

#[test]
fn a_window_frame_offers_the_words_of_its_bounds() {
    expect(
        "SELECT sum(x) OVER (ORDER BY y ROWS |",
        &["BETWEEN", "UNBOUNDED PRECEDING"],
        &[],
    );
    expect(
        "SELECT sum(x) OVER (ORDER BY y ROWS BETWEEN UNBOUNDED PRECEDING |",
        &["AND"],
        &[],
    );
    // The second bound, not a value: `AND` here is not the connective it is in a `WHERE`.
    expect(
        "SELECT sum(x) OVER (ORDER BY y ROWS BETWEEN 1 PRECEDING AND |",
        &["CURRENT ROW", "UNBOUNDED FOLLOWING"],
        &["CASE", "EXISTS"],
    );
}

#[test]
fn an_on_that_is_not_a_join_s_is_not_a_join_condition() {
    assert_ne!(
        position("CREATE INDEX idx ON orders (id) |"),
        "joinCondition"
    );
}

#[test]
fn a_join_to_a_subquery_still_takes_its_on() {
    // The subquery has clauses of its own; once it closes, the join it is the table of resumes.
    expect(
        "SELECT * FROM a JOIN (SELECT id FROM c) d |",
        &["ON", "USING"],
        &[],
    );
    expect(
        "SELECT * FROM a JOIN b ON a.id IN (SELECT id FROM c) |",
        &["WHERE", "JOIN"],
        &[],
    );
}

#[test]
fn every_position_covered_by_the_table_is_reachable() {
    // A position nothing classifies as would be a rule that never fires, and a generated row
    // nobody reads.
    let mut unreached: Vec<&str> = positron_sql_analyzer::keywords::POSITIONS
        .iter()
        .map(|position| position.name())
        .filter(|name| !POSITIONS.iter().any(|(_, reached)| reached == name))
        .collect();
    unreached.sort_unstable();
    assert_eq!(unreached, Vec::<&str>::new());
}

#[test]
fn no_position_is_answered_with_nothing() {
    // An empty list is a worse failure than an over-broad one: it is indistinguishable from the
    // extension being broken, and it silently removes a completion that used to work.
    // Except where nothing is the answer: a row count is a number, and the one keyword that could
    // stand there, `ALL`, is PostgreSQL's alone. See `a_row_count_offers_no_keyword_in_any_dialect`.
    // Nor does a plain name -- an alias, a column list, a `SET` target -- where any keyword is a
    // syntax error.
    for (marked, name) in POSITIONS {
        if *name == "rowCount" || *name == "identifier" {
            continue;
        }
        assert!(!offered(marked).is_empty(), "nothing offered at {marked:?}");
    }
}

#[test]
fn no_position_offers_punctuation_or_repeats_itself() {
    // The shape invariants the flat list had, now per position: the caller offers each list as it
    // arrives, so a duplicate would show as two identical completions.
    for (marked, _) in POSITIONS {
        let keywords = offered(marked);
        let mut sorted = keywords.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(keywords, sorted, "at {marked:?}");
        for keyword in &keywords {
            assert!(
                keyword.starts_with(|character: char| character.is_ascii_uppercase()),
                "{keyword:?} at {marked:?} does not start with a letter"
            );
        }
    }
}

#[test]
fn a_name_slot_offers_almost_nothing() {
    // The whole point of the exercise. This position used to offer all 1110 keywords, in a slot
    // where what belongs is the name of a table.
    assert_eq!(offered("SELECT * FROM |"), ["LATERAL", "TABLE", "UNNEST"]);
}

#[test]
fn only_a_ddl_object_name_is_offered_its_existence_check() {
    assert_eq!(offered("DROP TABLE |"), ["IF EXISTS", "IF NOT EXISTS"]);
    assert!(offered("SELECT a AS |").is_empty());
    assert!(offered("INSERT INTO |").is_empty());
}

#[test]
fn a_word_that_dictates_its_follower_offers_only_that() {
    assert_eq!(offered("SELECT * FROM orders GROUP |"), ["BY"]);
    assert_eq!(
        offered("SELECT * FROM orders ORDER BY id NULLS |"),
        ["FIRST", "LAST"]
    );
}

#[test]
fn the_select_list_and_the_clauses_after_it_are_told_apart() {
    expect(
        "SELECT |",
        &["DISTINCT", "CASE", "COUNT"],
        &["FROM", "WHERE", "ASC", "ZONE"],
    );
    expect(
        "SELECT total |",
        &["AS", "FROM"],
        &["SELECT", "DISTINCT", "ASC", "ZONE"],
    );
}

#[test]
fn a_table_reference_is_followed_by_clauses_and_joins() {
    expect(
        "SELECT * FROM orders |",
        &[
            "AS",
            "WHERE",
            "GROUP BY",
            "ORDER BY",
            "LEFT OUTER JOIN",
            "LIMIT",
        ],
        &["SELECT", "DISTINCT", "ASC", "ZONE", "ON"],
    );
    // `ON` belongs only after a table that was joined, which is why it is a position of its own.
    expect(
        "SELECT * FROM a JOIN b |",
        &["ON", "USING"],
        &["SELECT", "ZONE"],
    );
}

#[test]
fn a_condition_and_a_finished_condition_are_told_apart() {
    expect(
        "SELECT * FROM orders WHERE |",
        &["NOT", "EXISTS", "CASE", "NULL"],
        &["SELECT", "AND", "ASC", "ZONE", "GROUP BY"],
    );
    expect(
        "SELECT * FROM orders WHERE id = 1 |",
        &["AND", "OR", "IS NULL", "GROUP BY", "ORDER BY"],
        &["SELECT", "DISTINCT", "ASC", "ZONE", "WHERE"],
    );
}

#[test]
fn an_order_by_item_offers_its_own_words() {
    expect(
        "SELECT * FROM orders ORDER BY total |",
        &["ASC", "DESC", "NULLS FIRST", "LIMIT"],
        &["WHERE", "GROUP BY", "SELECT", "ZONE"],
    );
}

#[test]
fn a_write_statement_is_followed_by_its_own_clauses() {
    expect(
        "UPDATE orders |",
        &["SET", "AS"],
        &["WHERE", "SELECT", "ZONE"],
    );
    expect(
        "INSERT INTO orders |",
        &["VALUES", "SELECT"],
        &["WHERE", "ASC", "ZONE"],
    );
    expect(
        "CREATE TABLE orders (id |",
        &["INTEGER", "PRIMARY KEY", "NOT NULL"],
        &["SELECT", "WHERE"],
    );
}

#[test]
fn a_set_operator_is_followed_by_the_next_query() {
    expect(
        "SELECT a FROM orders UNION |",
        &["SELECT", "ALL", "DISTINCT"],
        &["WHERE", "JOIN"],
    );
    // Its `ALL` and `DISTINCT` are the operator's, not a select list's.
    assert_eq!(position("SELECT a UNION ALL |"), "setOperand");
    assert_eq!(
        position("SELECT a FROM orders EXCEPT DISTINCT |"),
        "setOperand"
    );
}

#[test]
fn an_update_assigns_to_columns_and_is_then_filtered() {
    assert_eq!(position("UPDATE orders SET |"), "identifier");
    assert_eq!(position("UPDATE orders SET a = 1, |"), "identifier");
    assert_eq!(position("UPDATE orders SET a = |"), "value");
    expect(
        "UPDATE orders SET a = 1 |",
        &["WHERE", "FROM"],
        &["GROUP BY", "HAVING", "LIMIT"],
    );
}

#[test]
fn a_values_row_holds_values_and_is_followed_by_the_insert_s_own_clauses() {
    assert_eq!(position("INSERT INTO orders VALUES (|"), "value");
    assert_eq!(position("INSERT INTO orders VALUES (1), (|"), "value");
    expect(
        "INSERT INTO orders VALUES (|",
        &["NULL", "DEFAULT"],
        &["SELECT"],
    );
    expect(
        "INSERT INTO orders VALUES (1) |",
        &["ON CONFLICT", "RETURNING"],
        &["GROUP BY", "HAVING"],
    );
    // A subquery inside a row is still a subquery.
    assert_eq!(position("INSERT INTO orders VALUES (1, (|"), "subquery");
}

#[test]
fn the_query_an_insert_reads_from_has_ordinary_clauses() {
    assert_eq!(
        position("INSERT INTO archive SELECT * FROM orders |"),
        "tableItem"
    );
}

#[test]
fn the_word_being_typed_is_not_read_as_one_the_statement_contains() {
    // At `FROM ord` the last token is `ord`, not `FROM`, and reading it as a finished word would
    // answer for the position after a table name rather than the position of the name itself.
    assert_eq!(position("SELECT * FROM ord|"), "name");
    // Five characters of a word that will become `WHERE`. The position that offers `WHERE` is by
    // definition the position the user is in while typing it.
    let (keywords, position) = at_cursor("SELECT * FROM orders WHERE|");
    assert_eq!(position, "tableItem");
    assert!(keywords.iter().any(|keyword| keyword == "WHERE"));
}

#[test]
fn punctuation_at_the_cursor_is_finished() {
    // There is no half typed `=`, so `WHERE x =` opens a value rather than sitting after `x`.
    assert_eq!(position("SELECT * FROM orders WHERE id =|"), "value");
    assert_eq!(position("SELECT * FROM orders WHERE id = 1|"), "expression");
}

#[test]
fn the_innermost_parenthesis_decides() {
    // A subquery in a WHERE answers for the subquery, not for the clause around it.
    assert_eq!(
        position("SELECT * FROM o WHERE cid IN (SELECT |"),
        "selectStart"
    );
    assert_eq!(
        position("SELECT * FROM o WHERE cid IN (SELECT id FROM |"),
        "name"
    );
    // And the clause around it again once the group has closed.
    assert_eq!(
        position("SELECT * FROM o WHERE cid IN (SELECT id FROM c) |"),
        "expression"
    );
}

#[test]
fn a_position_is_read_across_comments_and_literals() {
    // The reason this is in Rust rather than a raw-text scan on the TypeScript side: looking back
    // for the governing keyword has to see past whatever lies between.
    assert_eq!(
        position("SELECT * FROM orders -- a comment\n|"),
        "tableItem"
    );
    assert_eq!(
        position("SELECT * FROM orders /* from where? */ |"),
        "tableItem"
    );
    assert_eq!(position("SELECT 'from orders where' |"), "selectItem");
}

#[test]
fn a_table_named_after_a_keyword_is_still_a_table() {
    // sqlparser's keyword table is global and over a thousand entries, so plenty of ordinary names
    // are in it. `FROM order` is a table called `order`, not the start of an `ORDER BY`.
    assert_eq!(position("SELECT * FROM order |"), "tableItem");
    assert_eq!(position("SELECT * FROM value |"), "tableItem");
}

#[test]
fn an_offset_past_the_end_of_the_document_is_answered_rather_than_failing() {
    let response =
        request(json!({ "op": "keywordsAt", "text": "SELECT a FROM orders", "offset": 9999 }));
    assert_eq!(response["position"], "tableItem");
}

#[test]
fn a_position_that_cannot_be_placed_falls_back_to_everything() {
    // The judgement that keeps a heuristic's blind spots from costing the user a completion: an
    // over-broad list is what they had yesterday, an empty one looks like a bug.
    let (keywords, position) = at_cursor("GRANT |");
    assert_eq!(position, "everything");
    assert_eq!(keywords, keywords_at_no_position());
}

fn keywords_at_no_position() -> Vec<String> {
    request(json!({ "op": "keywords" }))["keywords"]
        .as_array()
        .unwrap()
        .iter()
        .map(|keyword| keyword.as_str().unwrap().to_string())
        .collect()
}

#[test]
fn every_dialect_is_offered_the_same_keywords() {
    // Withholding a word per dialect was tried and dropped: sqlparser's dialects are lenient in
    // different places, so what it rejects is as often its own gap as the dialect's. A word a
    // dialect lacks costs a line in a filtered list; a word withheld wrongly costs a completion.
    let (postgres, _) = at_cursor_as("postgres", "|");
    let (mysql, _) = at_cursor_as("mysql", "|");
    assert_eq!(postgres, mysql);
}

#[test]
fn an_unrecognized_dialect_is_answered_as_the_generic_one() {
    // The dialect is a plain string in the user's settings.json, so a typo is reachable, and it
    // must not cost them every keyword.
    let (unknown, _) = at_cursor_as("not-a-dialect", "SELECT * FROM orders |");
    let (generic, _) = at_cursor_as("", "SELECT * FROM orders |");
    assert_eq!(unknown, generic);
}

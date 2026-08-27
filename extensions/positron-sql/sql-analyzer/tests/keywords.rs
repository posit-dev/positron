/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

//! The keyword list completion offers.

mod support;

use serde_json::json;
use support::request;

fn keywords() -> Vec<String> {
    request(json!({ "op": "keywords" }))["keywords"]
        .as_array()
        .unwrap()
        .iter()
        .map(|keyword| keyword.as_str().unwrap().to_string())
        .collect()
}

#[test]
fn the_ordinary_keywords_are_offered() {
    let keywords = keywords();
    for expected in ["SELECT", "FROM", "WHERE", "JOIN", "INSERT", "DISTINCT"] {
        assert!(keywords.iter().any(|keyword| keyword == expected), "missing {expected}");
    }
}

#[test]
fn multi_word_keywords_are_offered_whole() {
    // sqlparser tokenizes each word separately and has no notion of a phrase, so these are ours.
    let keywords = keywords();
    for expected in ["GROUP BY", "ORDER BY", "LEFT OUTER JOIN", "UNION ALL"] {
        assert!(keywords.iter().any(|keyword| keyword == expected), "missing {expected}");
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
            keyword.chars().any(|character| character.is_ascii_uppercase()),
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

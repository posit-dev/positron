/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

//! Generating `src/keywords_generated.rs`, and checking the committed copy still matches.
//!
//! `src/keywords.rs` authors *candidate* keywords per position, because sqlparser holds no data
//! about where a keyword may appear. What it can do is judge a candidate: splice one onto a
//! fixture and see whether its parser takes it. Doing that for every dialect turns the authored
//! lists into a table nobody has to trust, and the check below is what stops them rotting.
//!
//! Run `npm run build-keywords` after changing a candidate list or a fixture, and commit the
//! result. Generation is not part of the build: it costs a few hundred thousand parses, and the
//! answer only changes when the lists or the sqlparser version do.

mod support;

use positron_sql_analyzer::dialects::CANONICAL;
use positron_sql_analyzer::keywords::{Position, POSITIONS};
use sqlparser::dialect::dialect_from_str;
use sqlparser::parser::{Parser, ParserError};
use std::collections::BTreeMap;

/// Where the generated table lives, relative to the crate root.
const GENERATED: &str = "src/keywords_generated.rs";

/// The environment variable that makes the generator write rather than compare.
const UPDATE: &str = "UPDATE_KEYWORD_TABLE";

/// An identifier no SQL author would write, for telling a keyword from a name.
const PROBE: &str = "positron_sql_probe";

/// sqlparser's own guard, matching [`positron_sql_analyzer::diagnostics`].
const RECURSION_LIMIT: usize = 50;

/// Parses and renders back, so two parses can be compared for the shape they produced.
fn render(dialect: &str, sql: &str) -> Result<String, ParserError> {
    let resolved = dialect_from_str(dialect).expect("every canonical name is one sqlparser knows");
    Parser::new(resolved.as_ref())
        .with_recursion_limit(RECURSION_LIMIT)
        .try_with_sql(sql)?
        .parse_statements()
        .map(|statements| {
            statements.iter().map(ToString::to_string).collect::<Vec<_>>().join("; ")
        })
}

/// Whether an error blames a token, as opposed to running out of input.
///
/// sqlparser locates an error at the token it rejected and leaves a message unlocated when it
/// simply wanted more, which is the distinction the whole oracle rests on: a candidate the parser
/// consumed before asking for more is a candidate it accepted.
fn blames_a_token(error: &ParserError) -> bool {
    match error {
        ParserError::RecursionLimitExceeded => true,
        ParserError::TokenizerError(message) | ParserError::ParserError(message) => {
            message.contains(" at Line: ")
        }
    }
}

/// Whether `dialect` accepts `keyword` written at the end of `fixture`, as syntax.
///
/// Two ways to fail. The parser may blame the keyword, which is a plain rejection. Or it may accept
/// it as an *identifier*: `SELECT * FROM orders ZONE` parses, because `ZONE` becomes a table alias,
/// and offering `ZONE` there is exactly the bug this exists to prevent. So a candidate that parses
/// is compared against the same fixture with a plain name in its place, and counted only if it
/// produced something structurally different.
fn accepts(dialect: &str, fixture: &str, keyword: &str) -> bool {
    match render(dialect, &format!("{fixture}{keyword}")) {
        Err(error) => !blames_a_token(&error),
        Ok(rendered) => match render(dialect, &format!("{fixture}{PROBE}")) {
            Ok(control) => !control.replace(PROBE, keyword).eq_ignore_ascii_case(&rendered),
            // The fixture takes no plain name, so there is nothing the keyword could be mistaken
            // for and parsing at all is proof enough.
            Err(_) => true,
        },
    }
}

/// What the generator decided about one candidate.
struct Verdict {
    /// The dialects that accepted it.
    accepted: Vec<&'static str>,
    /// Whether it is offered to every dialect rather than only to those that accepted it.
    universal: bool,
}

/// Judges one candidate at one position across every dialect.
///
/// The corroboration rule is the interesting part. sqlparser's dialects are lenient in different
/// places, so a rejection means two quite different things depending on how many dialects agree
/// with it. Fifteen dialects accepting `LIMIT` after a table reference and Snowflake rejecting it
/// is a gap in sqlparser's Snowflake support, not a fact about Snowflake -- honouring it would
/// withhold `LIMIT` from the users most likely to want it. One dialect accepting `LISTEN` and
/// fifteen rejecting it is a real dialect feature. So a rejection is trusted only when the
/// accepting dialects are in the minority.
fn judge(position: Position, keyword: &str) -> Verdict {
    let accepted: Vec<&'static str> = CANONICAL
        .iter()
        .copied()
        .filter(|dialect| {
            position.fixtures().iter().any(|fixture| accepts(dialect, fixture, keyword))
        })
        .collect();
    let universal = accepted.len() * 2 > CANONICAL.len();
    Verdict { accepted, universal }
}

/// The generated table, and the candidates no dialect accepted anywhere.
fn build() -> (String, Vec<String>) {
    // Offered by every dialect, per position.
    let mut base: Vec<Vec<&'static str>> = vec![Vec::new(); POSITIONS.len()];
    // Offered by one dialect on top of the base, keyed by dialect then position.
    let mut extra: BTreeMap<(&'static str, usize), Vec<&'static str>> = BTreeMap::new();
    let mut orphans: Vec<String> = Vec::new();

    for (index, position) in POSITIONS.iter().enumerate() {
        for keyword in position.candidates() {
            if !position.is_checkable() {
                // An identifier is a legal expression here, so the parser accepts every word and
                // its verdict says nothing. The authored list stands.
                base[index].push(keyword);
                continue;
            }
            let verdict = judge(*position, keyword);
            if verdict.accepted.is_empty() {
                orphans.push(format!("{}/{}", position.name(), keyword));
            } else if verdict.universal {
                base[index].push(keyword);
            } else {
                for dialect in verdict.accepted {
                    extra.entry((dialect, index)).or_default().push(keyword);
                }
            }
        }
        base[index].sort_unstable();
        base[index].dedup();
    }

    (emit(&base, &extra), orphans)
}

fn emit(
    base: &[Vec<&'static str>],
    extra: &BTreeMap<(&'static str, usize), Vec<&'static str>>,
) -> String {
    let mut out = String::new();
    out.push_str(
        "/*---------------------------------------------------------------------------------------------\n\
         \x20*  Copyright (C) 2026 Posit Software, PBC. All rights reserved.\n\
         \x20*  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.\n\
         \x20*--------------------------------------------------------------------------------------------*/\n\n",
    );
    out.push_str(
        "//! Which of `keywords.rs`'s candidates each dialect's parser actually accepts.\n\
         //!\n\
         //! GENERATED FILE -- do not edit. Run `npm run build-keywords` and commit the result.\n\
         //! The generator, and the reasoning behind the rule it applies, are in\n\
         //! `tests/keyword_table.rs`.\n\n",
    );

    out.push_str(
        "/// The keywords every dialect offers, indexed by position as `keywords::POSITIONS` is.\n\
         pub const BASE: &[&[&str]] = &[\n",
    );
    for (index, keywords) in base.iter().enumerate() {
        out.push_str(&format!("    // {}\n", POSITIONS[index].name()));
        out.push_str(&format!("    &{},\n", list(keywords)));
    }
    out.push_str("];\n\n");

    out.push_str(
        "/// The keywords a single dialect offers on top of [`BASE`], as `(dialect, position, added)`.\n\
         ///\n\
         /// Only ever additive: a keyword most dialects accept is offered to all of them, so the\n\
         /// entries here are the few that genuinely belong to a handful of dialects.\n\
         pub const EXTRA: &[(&str, usize, &[&str])] = &[\n",
    );
    for ((dialect, index), keywords) in extra {
        let mut keywords = keywords.clone();
        keywords.sort_unstable();
        keywords.dedup();
        out.push_str(&format!(
            "    (\"{dialect}\", {index}, &{}), // {}\n",
            list(&keywords),
            POSITIONS[*index].name()
        ));
    }
    out.push_str("];\n");
    out
}

/// A `&["A", "B"]` literal, wrapped so no line runs long.
fn list(keywords: &[&str]) -> String {
    if keywords.is_empty() {
        return "[]".to_string();
    }
    let mut lines: Vec<String> = Vec::new();
    let mut line = String::new();
    for keyword in keywords {
        let piece = format!("\"{keyword}\", ");
        if line.len() + piece.len() > 92 {
            lines.push(line.trim_end().to_string());
            line = String::new();
        }
        line.push_str(&piece);
    }
    if !line.is_empty() {
        lines.push(line.trim_end().to_string());
    }
    if lines.len() == 1 {
        format!("[{}]", lines[0].trim_end_matches(','))
    } else {
        format!("[\n        {}\n    ]", lines.join("\n        "))
    }
}

fn path() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(GENERATED)
}

#[test]
fn every_candidate_is_accepted_by_some_dialect() {
    // A candidate no dialect takes anywhere is an authoring mistake, and the only kind this can
    // catch: the parser can prove a keyword wrong, never prove one missing. `ON` after a plain
    // `FROM orders` was one of these -- it needs a JOIN first -- and so was `SET`, which belongs
    // to UPDATE.
    let (_, orphans) = build();
    assert_eq!(
        orphans,
        Vec::<String>::new(),
        "no dialect accepts these candidates at these positions; \
         fix the list in src/keywords.rs, or add a fixture that reaches them"
    );
}

#[test]
fn the_committed_table_matches_the_crate() {
    let (generated, _) = build();
    if std::env::var_os(UPDATE).is_some() {
        std::fs::write(path(), &generated).expect("the generated table is writable");
        return;
    }
    let committed = std::fs::read_to_string(path()).unwrap_or_default();
    assert_eq!(
        committed, generated,
        "{GENERATED} is out of date; run `npm run build-keywords` and commit the result"
    );
}

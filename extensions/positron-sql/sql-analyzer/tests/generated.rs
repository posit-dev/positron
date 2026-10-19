/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

//! Completion checked against statements generated at random, rather than against a list of
//! cases someone thought of.
//!
//! Each statement is built from a small grammar that records, as it goes, what is true at every
//! point in it: which word comes next, and which tables a column written there could belong to.
//! The statement is then cut at each of those points the way a user typing it would leave it, and
//! the analyzer's answer is held up against the record. The hand-written cases in `keywords.rs`
//! and `sources.rs` say what one statement should do; these say what every statement of a shape
//! should do, which is where a rule that fires in the wrong place shows up.
//!
//! The generator is seeded and self-contained rather than built on a property-testing crate: a
//! dependency would change `Cargo.lock`, which the committed wasm module is fingerprinted from.
//! Set `SQL_GENERATED_CASES` to run more statements, and `SQL_GENERATED_SEED` to replay a failure;
//! every failure names the seed of the statement it came from.

mod support;

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Value};
use support::request;

/// The dialects whose keyword lists are checked. The grammar below is written in SQL all of them
/// accept, so a keyword one of them does not offer is a gap, not a dialect difference.
const DIALECTS: &[&str] = &[
    "generic",
    "postgres",
    "mysql",
    "sqlite",
    "duckdb",
    "snowflake",
    "bigquery",
];

const TABLES: &[&str] = &["orders", "customers", "products", "line_items", "regions"];
const COLUMNS: &[&str] = &["id", "name", "total", "region_id", "created_at", "status"];

// --- The generator ---

/// A small, fast, seeded generator; quality is irrelevant, only repeatability matters.
struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Self {
        // Zero is the one state xorshift cannot leave.
        Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1)
    }

    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }

    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }

    /// True `percent` times in a hundred.
    fn chance(&mut self, percent: u64) -> bool {
        self.next() % 100 < percent
    }

    fn pick<'a, T>(&mut self, items: &'a [T]) -> &'a T {
        &items[self.below(items.len())]
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Keyword,
    /// A column reference: the place column completion is for.
    Column,
    /// Any other name -- a table, an alias, a function.
    Name,
    Punctuation,
    Literal,
}

struct Piece {
    text: String,
    kind: Kind,
    /// The query level the piece belongs to; an index into [`Statement::scopes`].
    scope: usize,
}

/// One query level: a select, a subquery or a CTE body.
struct Scope {
    /// The level whose tables this one can also see. A CTE body has none: it cannot see the
    /// select that reads from it.
    parent: Option<usize>,
    /// The real tables it reads from, with their aliases.
    tables: Vec<(String, Option<String>)>,
    /// Whether it reads from something whose columns cannot be known, i.e. a CTE.
    opaque: bool,
    /// What sort of level it is, for grouping failures: `top-level select`, `CTE body`,
    /// `subquery` or `derived table`.
    role: &'static str,
}

struct Statement {
    pieces: Vec<Piece>,
    scopes: Vec<Scope>,
}

impl Statement {
    /// The text, and the offset each piece starts at -- in bytes, which for a grammar written
    /// entirely in ASCII are also the UTF-16 units the analyzer counts in.
    fn render(&self) -> (String, Vec<usize>) {
        let mut text = String::new();
        let mut starts = Vec::new();
        for (index, piece) in self.pieces.iter().enumerate() {
            let glued = piece.text == "." || index > 0 && self.pieces[index - 1].text == ".";
            if index > 0 && !glued {
                text.push(' ');
            }
            starts.push(text.len());
            text.push_str(&piece.text);
        }
        (text, starts)
    }

    /// The tables a column at `scope` can belong to, as `name` or `name AS alias`, sorted.
    fn visible(&self, scope: usize) -> Vec<String> {
        let mut seen = Vec::new();
        let mut at = Some(scope);
        while let Some(id) = at {
            for (name, alias) in &self.scopes[id].tables {
                seen.push(match alias {
                    Some(alias) => format!("{name} AS {alias}"),
                    None => name.clone(),
                });
            }
            at = self.scopes[id].parent;
        }
        seen.sort();
        seen
    }

    fn opaque(&self, scope: usize) -> bool {
        let mut at = Some(scope);
        while let Some(id) = at {
            if self.scopes[id].opaque {
                return true;
            }
            at = self.scopes[id].parent;
        }
        false
    }
}

struct Builder<'r> {
    rng: &'r mut Rng,
    pieces: Vec<Piece>,
    scopes: Vec<Scope>,
    ctes: Vec<String>,
    aliases: usize,
}

/// What a FROM item made available to the rest of its select: the name a column is qualified by.
struct Source {
    qualifier: String,
}

impl<'r> Builder<'r> {
    fn push(&mut self, text: impl Into<String>, kind: Kind, scope: usize) {
        self.pieces.push(Piece {
            text: text.into(),
            kind,
            scope,
        });
    }

    fn keywords(&mut self, words: &str, scope: usize) {
        for word in words.split(' ') {
            self.push(word, Kind::Keyword, scope);
        }
    }

    fn scope(&mut self, parent: Option<usize>, role: &'static str) -> usize {
        self.scopes.push(Scope {
            parent,
            tables: Vec::new(),
            opaque: false,
            role,
        });
        self.scopes.len() - 1
    }

    fn statement(&mut self) {
        let top = self.scope(None, "top-level select");
        if self.rng.chance(30) {
            self.keywords("WITH", top);
            let count = 1 + self.rng.below(2);
            for index in 0..count {
                if index > 0 {
                    self.push(",", Kind::Punctuation, top);
                }
                let name = format!("cte_{index}");
                self.push(name.clone(), Kind::Name, top);
                self.keywords("AS", top);
                self.push("(", Kind::Punctuation, top);
                // A CTE body cannot see the select that reads from it, nor the CTEs after it.
                let body = self.scope(None, "CTE body");
                self.select(body, 0);
                self.push(")", Kind::Punctuation, top);
                self.ctes.push(name);
            }
        }
        self.select(top, 0);
    }

    /// A select, written at `scope`; `depth` keeps subqueries from nesting without end.
    fn select(&mut self, scope: usize, depth: usize) {
        self.keywords("SELECT", scope);
        if self.rng.chance(15) {
            self.keywords("DISTINCT", scope);
        }

        // The select list is written after the FROM is chosen, since it refers to what the FROM
        // names, but it has to come first in the text; so it is built aside and spliced in.
        let mut sources = Vec::new();
        let from_at = self.pieces.len();
        self.keywords("FROM", scope);
        sources.push(self.table_ref(scope, depth));
        for _ in 0..self.rng.below(3) {
            match self.rng.below(3) {
                0 => self.keywords("JOIN", scope),
                1 => self.keywords("LEFT JOIN", scope),
                _ => self.keywords("INNER JOIN", scope),
            }
            sources.push(self.table_ref(scope, depth));
            self.keywords("ON", scope);
            self.column(&sources, scope);
            self.push("=", Kind::Punctuation, scope);
            self.column(&sources, scope);
        }
        let from = self.pieces.split_off(from_at);

        let count = 1 + self.rng.below(3);
        for index in 0..count {
            if index > 0 {
                self.push(",", Kind::Punctuation, scope);
            }
            match self.rng.below(6) {
                5 if depth < 2 => {
                    // A scalar subquery, which may refer to the tables of the select around it.
                    self.push("(", Kind::Punctuation, scope);
                    let inner = self.scope(Some(scope), "subquery");
                    self.select(inner, depth + 1);
                    self.push(")", Kind::Punctuation, scope);
                }
                0 => {
                    self.push("COUNT", Kind::Name, scope);
                    self.push("(", Kind::Punctuation, scope);
                    self.push("*", Kind::Punctuation, scope);
                    self.push(")", Kind::Punctuation, scope);
                }
                4 => {
                    // A window function, frame and all.
                    self.push("SUM", Kind::Name, scope);
                    self.push("(", Kind::Punctuation, scope);
                    self.column(&sources, scope);
                    self.push(")", Kind::Punctuation, scope);
                    self.keywords("OVER", scope);
                    self.push("(", Kind::Punctuation, scope);
                    if self.rng.chance(60) {
                        self.keywords("PARTITION BY", scope);
                        self.column(&sources, scope);
                    }
                    self.keywords("ORDER BY", scope);
                    self.column(&sources, scope);
                    if self.rng.chance(50) {
                        self.keywords("ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW", scope);
                    }
                    self.push(")", Kind::Punctuation, scope);
                }
                1 => {
                    self.column(&sources, scope);
                    self.keywords("AS", scope);
                    let alias = format!("out_{index}");
                    self.push(alias, Kind::Name, scope);
                }
                _ => self.column(&sources, scope),
            }
        }
        self.pieces.extend(from);

        if self.rng.chance(60) {
            self.keywords("WHERE", scope);
            self.condition(&sources, scope, depth);
            if self.rng.chance(40) {
                let connective = if self.rng.chance(50) { "AND" } else { "OR" };
                self.keywords(connective, scope);
                self.condition(&sources, scope, depth);
            }
        }
        if self.rng.chance(30) {
            self.keywords("GROUP BY", scope);
            self.column(&sources, scope);
            if self.rng.chance(40) {
                self.keywords("HAVING", scope);
                self.push("COUNT", Kind::Name, scope);
                self.push("(", Kind::Punctuation, scope);
                self.push("*", Kind::Punctuation, scope);
                self.push(")", Kind::Punctuation, scope);
                self.push(">", Kind::Punctuation, scope);
                self.push("1", Kind::Literal, scope);
            }
        }
        if self.rng.chance(40) {
            self.keywords("ORDER BY", scope);
            self.column(&sources, scope);
            match self.rng.below(3) {
                0 => self.keywords("ASC", scope),
                1 => self.keywords("DESC", scope),
                _ => {}
            }
        }
        if depth == 0 && self.rng.chance(30) {
            self.keywords("LIMIT", scope);
            self.push("10", Kind::Literal, scope);
        }
    }

    /// A FROM or JOIN item: a table or a CTE, maybe aliased.
    fn table_ref(&mut self, scope: usize, depth: usize) -> Source {
        if depth < 2 && self.rng.chance(15) {
            // A derived table cannot see the other tables of the select it sits in, only those of
            // the queries around that select.
            self.push("(", Kind::Punctuation, scope);
            let parent = self.scopes[scope].parent;
            let derived = self.scope(parent, "derived table");
            self.select(derived, depth + 1);
            self.push(")", Kind::Punctuation, scope);
            self.aliases += 1;
            let alias = format!("d{}", self.aliases);
            if self.rng.chance(50) {
                self.keywords("AS", scope);
            }
            self.push(alias.clone(), Kind::Name, scope);
            self.scopes[scope].opaque = true;
            return Source { qualifier: alias };
        }
        let (name, real) = if !self.ctes.is_empty() && self.rng.chance(50) {
            (self.rng.pick(&self.ctes).clone(), false)
        } else {
            (self.rng.pick(TABLES).to_string(), true)
        };
        self.push(name.clone(), Kind::Name, scope);
        let alias = if self.rng.chance(60) {
            self.aliases += 1;
            let alias = format!("t{}", self.aliases);
            if self.rng.chance(50) {
                self.keywords("AS", scope);
            }
            self.push(alias.clone(), Kind::Name, scope);
            Some(alias)
        } else {
            None
        };
        if real {
            self.scopes[scope]
                .tables
                .push((name.clone(), alias.clone()));
        } else {
            self.scopes[scope].opaque = true;
        }
        Source {
            qualifier: alias.unwrap_or(name),
        }
    }

    /// A column, qualified by one of `sources` or not.
    fn column(&mut self, sources: &[Source], scope: usize) {
        if self.rng.chance(60) {
            let qualifier = self.rng.pick(sources).qualifier.clone();
            self.push(qualifier, Kind::Name, scope);
            self.push(".", Kind::Punctuation, scope);
        }
        let column = self.rng.pick(COLUMNS).to_string();
        self.push(column, Kind::Column, scope);
    }

    fn condition(&mut self, sources: &[Source], scope: usize, depth: usize) {
        match self.rng.below(6) {
            0 if depth < 2 => {
                self.column(sources, scope);
                self.keywords("IN", scope);
                self.push("(", Kind::Punctuation, scope);
                // A subquery sees out of itself: a correlated one may refer to the outer tables.
                let inner = self.scope(Some(scope), "subquery");
                self.select(inner, depth + 1);
                self.push(")", Kind::Punctuation, scope);
            }
            1 => {
                self.column(sources, scope);
                self.keywords("IS", scope);
                if self.rng.chance(50) {
                    self.keywords("NOT", scope);
                }
                self.keywords("NULL", scope);
            }
            2 => {
                self.column(sources, scope);
                self.keywords("BETWEEN", scope);
                self.push("1", Kind::Literal, scope);
                self.keywords("AND", scope);
                self.push("5", Kind::Literal, scope);
            }
            3 => {
                self.column(sources, scope);
                self.keywords("LIKE", scope);
                self.push("'a%'", Kind::Literal, scope);
            }
            _ => {
                self.column(sources, scope);
                let operator = *self.rng.pick(&["=", "<", ">", "<>"]);
                self.push(operator, Kind::Punctuation, scope);
                self.push("3", Kind::Literal, scope);
            }
        }
    }
}

fn generate(seed: u64) -> Statement {
    let mut rng = Rng::new(seed);
    let mut builder = Builder {
        rng: &mut rng,
        pieces: Vec::new(),
        scopes: Vec::new(),
        ctes: Vec::new(),
        aliases: 0,
    };
    builder.statement();
    Statement {
        pieces: builder.pieces,
        scopes: builder.scopes,
    }
}

// --- Asking the analyzer ---

fn keywords_at(text: &str, dialect: &str, offset: usize) -> (Vec<String>, String) {
    let response =
        request(json!({ "op": "keywordsAt", "text": text, "dialect": dialect, "offset": offset }));
    (
        strings(&response["keywords"]),
        response["position"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
    )
}

fn sources_at(text: &str, offset: usize) -> Value {
    request(json!({ "op": "sources", "text": text, "offset": offset }))
}

fn strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

fn named(response: &Value) -> Vec<String> {
    let mut named: Vec<String> = response["sources"]
        .as_array()
        .unwrap()
        .iter()
        .map(|source| {
            let name = source["name"].as_str().unwrap_or_default();
            match source["alias"].as_str() {
                Some(alias) => format!("{name} AS {alias}"),
                None => name.to_string(),
            }
        })
        .collect();
    named.sort();
    named
}

/// Whether `word` can be reached from `offered`: offered itself, or as the first word of a phrase.
fn reaches(offered: &[String], word: &str) -> bool {
    offered.iter().any(|keyword| {
        keyword.eq_ignore_ascii_case(word)
            || keyword.len() > word.len()
                && keyword[..word.len()].eq_ignore_ascii_case(word)
                && keyword.as_bytes()[word.len()] == b' '
    })
}

fn cases() -> Vec<u64> {
    if let Ok(seed) = std::env::var("SQL_GENERATED_SEED") {
        return vec![seed.parse().expect("SQL_GENERATED_SEED is a number")];
    }
    let count = std::env::var("SQL_GENERATED_CASES")
        .ok()
        .and_then(|count| count.parse().ok())
        .unwrap_or(300);
    (1..=count).collect()
}

/// Failures, grouped by what went wrong so that one bug reads as one line with a count rather
/// than as a thousand.
#[derive(Default)]
struct Failures {
    groups: BTreeMap<String, (usize, String, BTreeSet<String>)>,
}

impl Failures {
    fn add(&mut self, group: String, example: String) {
        self.tagged(group, example, None);
    }

    /// As [`Failures::add`], noting a variant -- a dialect, say -- the failure was seen under.
    fn tagged(&mut self, group: String, example: String, tag: Option<&str>) {
        let entry = self
            .groups
            .entry(group)
            .or_insert((0, example, BTreeSet::new()));
        entry.0 += 1;
        if let Some(tag) = tag {
            entry.2.insert(tag.to_string());
        }
    }

    fn assert_none(self, what: &str) {
        if self.groups.is_empty() {
            return;
        }
        let mut report = format!("{} kind(s) of {what}:\n", self.groups.len());
        for (group, (count, example, tags)) in &self.groups {
            let tags = if tags.is_empty() {
                String::new()
            } else {
                format!(
                    " in {}",
                    tags.iter().cloned().collect::<Vec<_>>().join(", ")
                )
            };
            report.push_str(&format!(
                "\n  {group}  [{count}x{tags}]\n    e.g. {example}\n"
            ));
        }
        panic!("{report}");
    }
}

/// The text with the cursor drawn in, for a failure message.
fn marked(text: &str, offset: usize) -> String {
    format!("{}|{}", &text[..offset], &text[offset..])
}

// --- The properties ---

/// Typing a statement from the start, every keyword it goes on to use is offered when the cursor
/// reaches the point where it is typed -- with nothing of it typed yet, and with its first letter
/// typed. A keyword that is not offered where valid SQL puts it is one the user has to type blind.
#[test]
fn the_next_keyword_of_a_valid_statement_is_offered() {
    let mut failures = Failures::default();
    for seed in cases() {
        let statement = generate(seed);
        let (text, starts) = statement.render();
        for (index, piece) in statement.pieces.iter().enumerate() {
            if piece.kind != Kind::Keyword {
                continue;
            }
            let start = starts[index];
            let before = &text[..start];
            let previous = describe(&statement.pieces[..index]);
            // One dialect per statement, rotating, rather than every dialect for every statement:
            // seven times cheaper, and over a run each dialect still sees every shape.
            for dialect in [DIALECTS[seed as usize % DIALECTS.len()]] {
                for typed in [0, 1] {
                    let typing = format!("{before}{}", &piece.text[..typed]);
                    let (offered, position) = keywords_at(&typing, dialect, typing.len());
                    if !reaches(&offered, &piece.text) {
                        failures.tagged(
                            format!("{} not offered after {previous} ({position})", piece.text),
                            format!("seed {seed}: {typing}|"),
                            Some(dialect),
                        );
                    }
                }
            }
        }
    }
    failures.assert_none("keyword missing where a valid statement uses it");
}

/// At every column in a generated statement, with the column removed and with its first letter
/// typed, the tables the cursor can see are exactly the ones the query level it is in reads from,
/// and those of the levels around it -- never those of a subquery or a CTE it is not inside.
#[test]
fn the_tables_in_scope_at_a_column_are_the_ones_its_query_can_see() {
    let mut failures = Failures::default();
    for seed in cases() {
        let statement = generate(seed);
        for (index, piece) in statement.pieces.iter().enumerate() {
            if piece.kind != Kind::Column {
                continue;
            }
            let expected = statement.visible(piece.scope);
            let opaque = statement.opaque(piece.scope);
            let original = piece.text.clone();
            for typed in ["", &original[..1]] {
                let mut edited = Statement {
                    pieces: statement
                        .pieces
                        .iter()
                        .map(|piece| Piece {
                            text: piece.text.clone(),
                            ..*piece
                        })
                        .collect(),
                    scopes: Vec::new(),
                };
                edited.pieces[index].text = typed.to_string();
                let (text, starts) = edited.render();
                let offset = starts[index] + typed.len();
                let response = sources_at(&text, offset);
                let found = named(&response);
                let origin = response["origin"].as_str().unwrap_or_default().to_string();
                let example = format!("seed {seed}: {}", marked(&text, offset));
                if origin != "parsed" {
                    failures.tagged(
                        format!(
                            "answered from tokens, not a parse, at a column in a {}",
                            statement.scopes[piece.scope].role
                        ),
                        example.clone(),
                        Some(hole(typed)),
                    );
                }
                if found != expected {
                    let extra: BTreeSet<String> = found
                        .iter()
                        .filter(|table| !expected.contains(table))
                        .map(|table| {
                            format!("extra table from {}", whose(&statement, table, piece.scope))
                        })
                        .collect();
                    let missing: BTreeSet<String> = expected
                        .iter()
                        .filter(|table| !found.contains(table))
                        .map(|_| "missing a table it can see".to_string())
                        .collect();
                    let what: Vec<String> = extra.into_iter().chain(missing).collect();
                    failures.tagged(
                        format!(
                            "{} at a column in a {}",
                            what.join(" and "),
                            statement.scopes[piece.scope].role
                        ),
                        format!("{example}\n      expected {expected:?}, got {found:?}"),
                        Some(hole(typed)),
                    );
                }
                if response["opaque"].as_bool() != Some(opaque) {
                    failures.tagged(
                        format!(
                            "opaque should be {opaque} at a column in a {}",
                            statement.scopes[piece.scope].role
                        ),
                        example,
                        Some(hole(typed)),
                    );
                }
            }
        }
    }
    failures.assert_none("wrong scope at a column");
}

/// What the cursor comes after, in the terms a failure is grouped by: the word itself for a
/// keyword or a bracket, and the clause it is in for a name or a value, which only matter by kind.
fn describe(before: &[Piece]) -> String {
    let Some(last) = before.last() else {
        return "the start".to_string();
    };
    let clause = before
        .iter()
        .rev()
        .find(|piece| piece.kind == Kind::Keyword)
        .map(|piece| piece.text.as_str())
        .unwrap_or("nothing");
    match last.kind {
        Kind::Keyword => format!("`{}`", last.text),
        Kind::Punctuation => format!("`{}` after `{clause}`", last.text),
        Kind::Column => format!("a column after `{clause}`"),
        Kind::Name => format!("a name after `{clause}`"),
        Kind::Literal => format!("a value after `{clause}`"),
    }
}

/// Which query level a table the answer got wrong belongs to, relative to the cursor's.
fn whose(statement: &Statement, table: &str, cursor: usize) -> String {
    let mut chain = Vec::new();
    let mut at = Some(cursor);
    while let Some(id) = at {
        chain.push(id);
        at = statement.scopes[id].parent;
    }
    for (id, scope) in statement.scopes.iter().enumerate() {
        let holds = scope.tables.iter().any(|(name, alias)| match alias {
            Some(alias) => format!("{name} AS {alias}") == table,
            None => name == table,
        });
        if holds {
            return if chain.contains(&id) {
                "its own query or one around it".to_string()
            } else {
                format!("a {} it is not inside", scope.role)
            };
        }
    }
    "nowhere".to_string()
}

fn hole(typed: &str) -> &'static str {
    if typed.is_empty() {
        "column removed"
    } else {
        "first letter typed"
    }
}

/// Every offset of every statement, cut short and mangled, is answered: no panic, which in the
/// wasm module would take completion, diagnostics and statement ranges down with it, and never an
/// empty keyword list, which the user cannot tell from a broken extension.
#[test]
fn every_offset_of_a_mangled_statement_is_answered() {
    let mut failures = Failures::default();
    // A twenty-fifth of the statements the other properties take: each is asked about at every
    // offset, in four variants. Raising SQL_GENERATED_CASES raises this with them.
    let cases = cases();
    let count = cases.len().div_ceil(25);
    for seed in cases.into_iter().take(count) {
        let statement = generate(seed);
        let (text, _) = statement.render();
        let mut rng = Rng::new(seed ^ 0xDEAD_BEEF);
        let mut variants = vec![text.clone()];
        for _ in 0..3 {
            let mut bytes: Vec<char> = text.chars().collect();
            let at = rng.below(bytes.len());
            match rng.below(4) {
                0 => {
                    bytes.truncate(at);
                }
                1 => {
                    let end = (at + 1 + rng.below(8)).min(bytes.len());
                    bytes.drain(at..end);
                }
                2 => {
                    for (offset, inserted) in rng
                        .pick(&["(", "'", "\"", ")", ";", "--", "\u{e9}\u{1F600}"])
                        .chars()
                        .enumerate()
                    {
                        bytes.insert(at + offset, inserted);
                    }
                }
                _ => {
                    let other = generate(seed + 1_000_000).render().0;
                    let splice: Vec<char> = other.chars().collect();
                    // A stretch of another statement, short enough that the variants stay the size a
                    // statement is rather than growing with every splice.
                    let from = rng.below(splice.len());
                    let to = (from + 1 + rng.below(30)).min(splice.len());
                    bytes.splice(at..at, splice[from..to].iter().copied());
                }
            }
            variants.push(bytes.into_iter().collect());
        }
        for variant in variants {
            let units: Vec<u16> = variant.encode_utf16().collect();
            // Every UTF-16 offset, including those inside a surrogate pair, and two past the end.
            for offset in 0..=units.len() + 2 {
                // Sources parses the statement, several times over, so it is asked at every fourth
                // offset and wherever a character outside ASCII is near; keywords only tokenizes,
                // and is asked everywhere.
                let near_wide = units
                    [offset.saturating_sub(2).min(units.len())..(offset + 2).min(units.len())]
                    .iter()
                    .any(|unit| *unit > 0x7F);
                let ask_sources = offset % 4 == 0 || near_wide;
                let result = std::panic::catch_unwind(|| {
                    let (keywords, position) = keywords_at(&variant, "generic", offset);
                    let sources = if ask_sources {
                        sources_at(&variant, offset)
                    } else {
                        json!({ "sources": [] })
                    };
                    (keywords, position, sources)
                });
                match result {
                    Err(_) => failures.add(
                        "panicked".to_string(),
                        format!("seed {seed} at {offset}: {variant:?}"),
                    ),
                    Ok((keywords, position, sources)) => {
                        // A row count offers nothing on purpose: a number belongs there, and the one
                        // keyword that could, `ALL`, is PostgreSQL's alone. See `Position::RowCount`.
                        if keywords.is_empty() && position != "rowCount" {
                            failures.add(
                                format!("no keywords ({position})"),
                                format!("seed {seed} at {offset}: {variant:?}"),
                            );
                        }
                        if !sources["sources"].is_array() {
                            failures.add(
                                format!("no sources: {sources}"),
                                format!("seed {seed} at {offset}: {variant:?}"),
                            );
                        }
                    }
                }
            }
        }
    }
    failures.assert_none("unanswered offset");
}

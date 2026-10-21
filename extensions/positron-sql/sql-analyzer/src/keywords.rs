/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

//! Which keywords are worth completing where the cursor is.
//!
//! Offering every keyword at every position, which is what this replaced, means offering `ZONE`
//! and `ABSOLUTE` in the middle of a `WHERE` clause and all 1092 of sqlparser's keywords in a slot
//! where only a table name belongs. So the position has to be read off the text -- and, like
//! [`crate::sources`], off the *tokens* rather than a parse tree, because completion is only ever
//! asked about a statement halfway through being typed and sqlparser has no error recovery.
//!
//! # Where the answers come from
//!
//! sqlparser holds no data about where a keyword may appear, so none can be read out of it. Its
//! grammar lives in the control flow of a hand-written recursive descent parser; `ParserError` is
//! a `String`, the ~195 `expected(...)` sites take free-form English, and the four
//! `RESERVED_FOR_*` tables are *exclusion* sets for the parser's own alias handling. So the
//! lists below are authored here, and offered to every dialect alike.
//!
//! Not per dialect, on purpose. Trial parsing each candidate against each of sqlparser's dialects
//! was tried, and withheld a handful of words from a handful of dialects -- `LISTEN` outside
//! PostgreSQL, `TRIGGER` where sqlparser has no `CREATE TRIGGER` -- for a generator, a committed
//! table and a CI check. A word a dialect lacks costs one line in a list the user is already
//! filtering by prefix, and a word withheld wrongly costs them a completion, so the lists stand
//! as written.
//!
//! # What this does not place
//!
//! The positions inside a construct whose own keywords are obligatory but whose extent this does
//! not track: the arms of a `CASE` (`WHEN`, `THEN`, `ELSE`, `END`), the `ESCAPE` of a `LIKE`, and
//! the actions of an `ALTER TABLE`. Each would need the scan to know it is inside that construct,
//! which is more than the token stream gives up cheaply. They fall to [`Position::Everything`] or
//! to the surrounding expression, so the words are still reachable by prefix -- they are simply
//! not promoted. Deliberate, and the first thing to revisit if the completions feel thin.

use sqlparser::keywords::Keyword;
use sqlparser::tokenizer::{Token, TokenWithSpan, Word};

use crate::statements::Statement;
use crate::text::TextIndex;
use crate::tokens::{self, word};

/// Where the cursor is, as far as the keywords that belong there are concerned.
///
/// Not a grammar. Two positions the grammar distinguishes are one variant here whenever they would
/// offer the same words, because a wrong entry costs one line in a list the user is filtering by
/// prefix anyway, while a variant costs a rule that has to be right.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Position {
    /// The beginning of a statement: nothing typed yet, or the cursor is between two.
    StatementStart,
    /// After `CREATE`, `ALTER`, `DROP` or `TRUNCATE`, where the object kind belongs.
    Ddl,
    /// Directly after `SELECT`, or after its `DISTINCT`/`ALL`.
    SelectStart,
    /// After a complete item in the select list.
    SelectItem,
    /// Where the name of a table being read belongs, after `FROM` or `JOIN`, and so almost no
    /// keyword does. The slot that previously offered all 1110.
    Name,
    /// Where the name of the object a DDL statement acts on belongs: `DROP TABLE |`.
    ObjectName,
    /// Where a name and nothing else belongs: an alias after `AS`, a column list, the column a
    /// `SET` assigns, the table an `INSERT INTO` or an `UPDATE` writes.
    Identifier,
    /// After a complete table reference in a `FROM`.
    TableItem,
    /// After a table reference that followed a `JOIN`, which additionally takes `ON`/`USING`.
    JoinedItem,
    /// After the table of an `UPDATE`, which takes `SET`.
    UpdateItem,
    /// After the table of an `INSERT INTO`, which takes `VALUES`, `SELECT` or a column list.
    InsertTarget,
    /// Where an expression may begin: after a clause keyword, a connective, an operator or a
    /// comma in an expression list.
    Value,
    /// Directly after `(`, which may open a subquery as well as an expression.
    Subquery,
    /// After a complete expression in a clause that takes one.
    Expression,
    /// After a complete join condition, its `ON` expression or its `USING` list, where the query
    /// may go on to another join or to its `WHERE` -- neither of which may follow the expression
    /// of a `WHERE` itself.
    JoinCondition,
    /// After an `ORDER BY` item.
    OrderItem,
    /// Directly after `OVER (`.
    WindowSpec,
    /// In a `CREATE TABLE` column list, or after the `AS` of a `CAST`, where a type belongs.
    ColumnDefinition,
    /// After a bare `GROUP`, `ORDER` or `PARTITION`, which all take `BY`.
    ExpectingBy,
    /// After `LEFT`, `RIGHT`, `FULL`, `INNER`, `CROSS`, `OUTER` or `NATURAL`.
    ExpectingJoin,
    /// After the `NULLS` of an `ORDER BY` item.
    ExpectingNullsOrder,
    /// After the `IS` of a predicate.
    ExpectingIsPredicate,
    /// After `UNION`, `INTERSECT`, `EXCEPT` or `MINUS`, or their `ALL` or `DISTINCT`, where the
    /// next query begins.
    SetOperand,
    /// After a complete assignment in the `SET` of an `UPDATE`.
    Assignment,
    /// After a complete row of an `INSERT`'s `VALUES`.
    ValuesRow,
    /// Where a row count belongs: after `LIMIT`, `OFFSET`, `TOP`, the comma of MySQL's
    /// `LIMIT offset, count`, or the `FIRST`/`NEXT` of a `FETCH`. A count is a number, so no
    /// column, table or alias belongs here either, and the caller is told by name so it can leave
    /// them out.
    RowCount,
    /// The position could not be placed, so everything is offered. Deliberately not an empty
    /// list: an empty one is indistinguishable from the extension being broken, and silently
    /// removes a completion that used to work.
    Everything,
    /// In the ggsql `VISUALISE` part of a statement, which is not SQL, so no SQL keyword belongs.
    /// The one position that offers nothing, on purpose, and named so the caller can tell.
    Visualise,
}

/// Every position that has a list of its own.
///
/// `Everything` is absent: it answers from the whole vocabulary rather than from a list. So is
/// `Visualise`, which answers with nothing.
pub const POSITIONS: &[Position] = &[
    Position::StatementStart,
    Position::Ddl,
    Position::SelectStart,
    Position::SelectItem,
    Position::Name,
    Position::ObjectName,
    Position::Identifier,
    Position::TableItem,
    Position::JoinedItem,
    Position::UpdateItem,
    Position::InsertTarget,
    Position::Value,
    Position::Subquery,
    Position::Expression,
    Position::JoinCondition,
    Position::OrderItem,
    Position::WindowSpec,
    Position::ColumnDefinition,
    Position::ExpectingBy,
    Position::ExpectingJoin,
    Position::ExpectingNullsOrder,
    Position::ExpectingIsPredicate,
    Position::SetOperand,
    Position::Assignment,
    Position::ValuesRow,
    Position::RowCount,
];

impl Position {
    /// The name the caller logs, so a surprising list can be traced to the rule that produced it.
    pub fn name(self) -> &'static str {
        match self {
            Position::StatementStart => "statementStart",
            Position::Ddl => "ddl",
            Position::SelectStart => "selectStart",
            Position::SelectItem => "selectItem",
            Position::Name => "name",
            Position::ObjectName => "objectName",
            Position::Identifier => "identifier",
            Position::TableItem => "tableItem",
            Position::JoinedItem => "joinedItem",
            Position::UpdateItem => "updateItem",
            Position::InsertTarget => "insertTarget",
            Position::Value => "value",
            Position::Subquery => "subquery",
            Position::Expression => "expression",
            Position::JoinCondition => "joinCondition",
            Position::OrderItem => "orderItem",
            Position::WindowSpec => "windowSpec",
            Position::ColumnDefinition => "columnDefinition",
            Position::ExpectingBy => "expectingBy",
            Position::ExpectingJoin => "expectingJoin",
            Position::ExpectingNullsOrder => "expectingNullsOrder",
            Position::ExpectingIsPredicate => "expectingIsPredicate",
            Position::SetOperand => "setOperand",
            Position::Assignment => "assignment",
            Position::ValuesRow => "valuesRow",
            Position::RowCount => "rowCount",
            Position::Everything => "everything",
            Position::Visualise => "visualise",
        }
    }

    /// The keywords offered at this position, sorted and deduplicated.
    pub fn candidates(self) -> Vec<&'static str> {
        let mut all: Vec<&'static str> = match self {
            Position::StatementStart => STATEMENT_START.to_vec(),
            Position::Ddl => DDL.to_vec(),
            Position::SelectStart => {
                [VALUE_STARTERS, &["ALL", "DISTINCT", "DISTINCT ON", "TOP"]].concat()
            }
            Position::SelectItem => [
                OPERATORS,
                CALL_SUFFIXES,
                SET_OPERATORS,
                &["AS", "FROM", "INTO"],
            ]
            .concat(),
            Position::Name => NAME.to_vec(),
            Position::ObjectName => ["IF EXISTS", "IF NOT EXISTS"].to_vec(),
            Position::Identifier => Vec::new(),
            Position::TableItem => [TABLE_TAIL, TABLE_TAIL_CLAUSES, JOINS, &["RETURNING"]].concat(),
            Position::JoinedItem => {
                [TABLE_TAIL, TABLE_TAIL_CLAUSES, JOINS, &["ON", "USING"]].concat()
            }
            Position::UpdateItem => [TABLE_TAIL, &["AS", "FROM", "SET"]].concat(),
            Position::InsertTarget => ["DEFAULT VALUES", "SELECT", "VALUES", "WITH", "AS"].to_vec(),
            Position::Value => [VALUE_STARTERS, GROUPING_MODIFIERS].concat(),
            Position::Subquery => [
                VALUE_STARTERS,
                GROUPING_MODIFIERS,
                &["ALL", "DISTINCT", "SELECT", "VALUES", "WITH"],
            ]
            .concat(),
            Position::Expression => [OPERATORS, PREDICATE_TAIL_CLAUSES, SET_OPERATORS].concat(),
            Position::JoinCondition => {
                [OPERATORS, TABLE_TAIL_CLAUSES, JOINS, SET_OPERATORS].concat()
            }
            Position::OrderItem => [
                OPERATORS,
                &[
                    "ASC",
                    "DESC",
                    "NULLS FIRST",
                    "NULLS LAST",
                    "COLLATE",
                    "FETCH",
                    "FOR UPDATE",
                    "LIMIT",
                    "OFFSET",
                ],
            ]
            .concat(),
            Position::WindowSpec => WINDOW_SPEC.to_vec(),
            Position::ColumnDefinition => [DATA_TYPES, COLUMN_CONSTRAINTS].concat(),
            Position::ExpectingBy => ["BY"].to_vec(),
            Position::ExpectingJoin => {
                ["JOIN", "OUTER", "OUTER JOIN", "ANTI JOIN", "SEMI JOIN"].to_vec()
            }
            Position::ExpectingNullsOrder => ["FIRST", "LAST"].to_vec(),
            Position::ExpectingIsPredicate => [
                "DISTINCT FROM",
                "FALSE",
                "NOT",
                "NOT DISTINCT FROM",
                "NOT FALSE",
                "NOT NULL",
                "NOT TRUE",
                "NULL",
                "TRUE",
                "UNKNOWN",
            ]
            .to_vec(),
            Position::SetOperand => ["ALL", "DISTINCT", "SELECT", "VALUES"].to_vec(),
            Position::Assignment => [OPERATORS, &["FROM", "RETURNING", "WHERE"]].concat(),
            Position::ValuesRow => ["ON CONFLICT", "ON DUPLICATE KEY UPDATE", "RETURNING"].to_vec(),
            // A number or a parameter goes here, so no keyword is offered. Not even PostgreSQL's
            // `LIMIT ALL`, which is a syntax error in MySQL and would be offered to both. Typing
            // `A` still reaches it through the whole-vocabulary fallback.
            Position::RowCount => Vec::new(),
            Position::Everything | Position::Visualise => Vec::new(),
        };
        all.sort_unstable();
        all.dedup();
        all
    }
}

/// The words a value may begin with, wherever an expression may start.
const VALUE_STARTERS: &[&str] = &[
    "ARRAY",
    "CASE",
    "CAST",
    "COALESCE",
    "COUNT",
    "CURRENT_DATE",
    "CURRENT_TIME",
    "CURRENT_TIMESTAMP",
    "CURRENT_USER",
    "DATE",
    "DEFAULT",
    "EXISTS",
    "EXTRACT",
    "FALSE",
    "INTERVAL",
    "MAX",
    "MIN",
    "NOT",
    "NULL",
    "NULLIF",
    "SUBSTRING",
    "SUM",
    "TIME",
    "TIMESTAMP",
    "TRIM",
    "TRUE",
    "TRY_CAST",
];

/// The operators and predicates that continue a value once one has been written.
const OPERATORS: &[&str] = &[
    "AND",
    "AT TIME ZONE",
    "BETWEEN",
    "COLLATE",
    "ILIKE",
    "IN",
    "IS",
    "IS DISTINCT FROM",
    "IS FALSE",
    "IS NOT DISTINCT FROM",
    "IS NOT NULL",
    "IS NULL",
    "IS TRUE",
    "LIKE",
    "NOT BETWEEN",
    "NOT ILIKE",
    "NOT IN",
    "NOT LIKE",
    "OR",
    "OVERLAPS",
    "RLIKE",
    "SIMILAR TO",
];

/// The clauses that may follow the `FROM` list of a query.
const TABLE_TAIL_CLAUSES: &[&str] = &[
    "FETCH", "GROUP BY", "HAVING", "LIMIT", "OFFSET", "ORDER BY", "QUALIFY", "WHERE", "WINDOW",
];

/// The clauses that may follow a complete predicate, which `WHERE` may not: it has already been
/// written by the time the cursor is here.
const PREDICATE_TAIL_CLAUSES: &[&str] = &[
    "FETCH",
    "FOR UPDATE",
    "GROUP BY",
    "HAVING",
    "LIMIT",
    "OFFSET",
    "ORDER BY",
    "QUALIFY",
    "WINDOW",
];

/// The operators that combine one query with another.
const SET_OPERATORS: &[&str] = &["EXCEPT", "INTERSECT", "MINUS", "UNION", "UNION ALL"];

/// The suffixes an aggregate or window call takes.
const CALL_SUFFIXES: &[&str] = &["FILTER", "OVER", "WITHIN GROUP"];

/// The words that may follow a complete table reference whatever clause it sits in.
const TABLE_TAIL: &[&str] = &["AS", "MATCH_RECOGNIZE", "PIVOT", "TABLESAMPLE", "UNPIVOT"];

/// Every spelling of a join.
const JOINS: &[&str] = &[
    "CROSS JOIN",
    "FULL JOIN",
    "FULL OUTER JOIN",
    "INNER JOIN",
    "JOIN",
    "LEFT JOIN",
    "LEFT OUTER JOIN",
    "NATURAL JOIN",
    "RIGHT JOIN",
    "RIGHT OUTER JOIN",
];

/// The few words that belong where a table being read is named.
const NAME: &[&str] = &["LATERAL", "TABLE", "UNNEST"];

/// The modifiers a `GROUP BY` list takes.
const GROUPING_MODIFIERS: &[&str] = &["CUBE", "GROUPING SETS", "ROLLUP"];

/// What a window specification is built from.
const WINDOW_SPEC: &[&str] = &[
    "AND",
    "BETWEEN",
    "CURRENT ROW",
    "FOLLOWING",
    "GROUPS",
    "ORDER BY",
    "PARTITION BY",
    "PRECEDING",
    "RANGE",
    "ROW",
    "ROWS",
    "UNBOUNDED FOLLOWING",
    "UNBOUNDED PRECEDING",
];

/// The verbs a statement may begin with.
const STATEMENT_START: &[&str] = &[
    "ALTER TABLE",
    "ALTER VIEW",
    "ANALYZE",
    "BEGIN",
    "CALL",
    "COMMIT",
    "COPY",
    "CREATE",
    "CREATE INDEX",
    "CREATE MATERIALIZED VIEW",
    "CREATE OR REPLACE VIEW",
    "CREATE SCHEMA",
    "CREATE TABLE",
    "CREATE TEMPORARY TABLE",
    "CREATE VIEW",
    "DELETE FROM",
    "DESCRIBE",
    "DROP INDEX",
    "DROP TABLE",
    "DROP VIEW",
    "EXECUTE",
    "EXPLAIN",
    "GRANT",
    "INSERT INTO",
    "LISTEN",
    "MERGE INTO",
    "NOTIFY",
    "PRAGMA",
    "PREPARE",
    "REVOKE",
    "ROLLBACK",
    "SELECT",
    "SET",
    "SHOW",
    "START TRANSACTION",
    "TRUNCATE TABLE",
    "UNLISTEN",
    "UPDATE",
    "USE",
    "VACUUM",
    "VALUES",
    "WITH",
    "WITH RECURSIVE",
];

/// The object kinds and modifiers a DDL verb takes.
const DDL: &[&str] = &[
    "DATABASE",
    "EXTERNAL TABLE",
    "FUNCTION",
    "INDEX",
    "MATERIALIZED VIEW",
    "OR REPLACE",
    "PROCEDURE",
    "SCHEMA",
    "SEQUENCE",
    "TABLE",
    "TEMPORARY TABLE",
    "TRIGGER",
    "UNIQUE INDEX",
    "VIEW",
];

/// The type names a column definition may use.
const DATA_TYPES: &[&str] = &[
    "ARRAY",
    "BIGINT",
    "BLOB",
    "BOOLEAN",
    "BYTEA",
    "CHAR",
    "DATE",
    "DECIMAL",
    "DOUBLE",
    "DOUBLE PRECISION",
    "FLOAT",
    "INT",
    "INTEGER",
    "INTERVAL",
    "JSON",
    "JSONB",
    "NUMERIC",
    "REAL",
    "SMALLINT",
    "TEXT",
    "TIME",
    "TIMESTAMP",
    "TIMESTAMP WITH TIME ZONE",
    "TINYINT",
    "UUID",
    "VARCHAR",
];

/// The constraints a column definition may carry.
const COLUMN_CONSTRAINTS: &[&str] = &[
    "AUTOINCREMENT",
    "CHECK",
    "COLLATE",
    "COMMENT",
    "CONSTRAINT",
    "DEFAULT",
    "GENERATED ALWAYS AS",
    "NOT NULL",
    "NULL",
    "PRIMARY KEY",
    "REFERENCES",
    "UNIQUE",
];

/// The multi-word keywords worth offering whole.
///
/// sqlparser tokenizes each word separately and its keyword table has no notion of a phrase, so
/// none of these are in it. Collected here as well as distributed into the positions above, so
/// that the fallback list can never lack a phrase some position offers.
pub fn phrases() -> Vec<&'static str> {
    let mut all: Vec<&'static str> = POSITIONS
        .iter()
        .flat_map(|position| position.candidates())
        .filter(|keyword| keyword.contains(' '))
        .collect();
    all.sort_unstable();
    all.dedup();
    all
}

/// Every keyword the analyzer knows, sorted and deduplicated: the answer when the position cannot
/// be placed.
///
/// sqlparser keeps one keyword table for all dialects, so this does not vary with the configured
/// dialect. That over-offers, and where the position *is* known its own short list is what avoids
/// it. Here, where it is not, over-offering is the point: a keyword a dialect does not have costs
/// an entry in a list the user is filtering by prefix anyway, and an empty list at a position the
/// scan failed to recognize would cost the user a completion that used to work, with no way to
/// tell why.
pub fn everything() -> Vec<String> {
    let mut all: Vec<String> = sqlparser::keywords::ALL_KEYWORDS
        .iter()
        .map(|keyword| (*keyword).to_string())
        .chain(phrases().iter().map(|phrase| (*phrase).to_string()))
        .collect();
    all.sort_unstable();
    all.dedup();
    all
}

/// The keywords worth completing at a position.
pub fn offered(position: Position) -> Vec<String> {
    match position {
        Position::Visualise => Vec::new(),
        Position::Everything => everything(),
        _ => position
            .candidates()
            .into_iter()
            .map(ToString::to_string)
            .collect(),
    }
}

/// The keywords worth completing at an offset in a statement.
///
/// `statement` is `None` when the offset falls between statements, which is the user starting a
/// new one.
pub fn at(statement: Option<&Statement>, offset: u32, index: &TextIndex) -> Position {
    let Some(statement) = statement else {
        return Position::StatementStart;
    };
    if statement.in_visualise(offset) {
        return Position::Visualise;
    }
    // Only what the user has finished typing: at `WHERE|` the five characters are a word becoming
    // `WHERE`, and reading them as a finished one would answer for the position after it.
    let (finished, _) = tokens::around(&statement.tokens, offset, index);
    place(finished)
}

/// What the parenthesis the cursor sits inside was opened by.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Group {
    /// Not inside one.
    None,
    /// After `OVER`, so the group is a window specification.
    Window,
    /// After `CAST`, `TRY_CAST` or `SAFE_CAST`, so what follows its `AS` is a type.
    Cast,
    /// In a `CREATE`, so the group is a column definition list.
    Definition,
    /// In an `INSERT INTO`, so the group is a list of column names.
    Columns,
    /// A row of a `VALUES` list, which holds values but not a query.
    Row,
    /// Anything else: an expression list, a function call, or a subquery.
    Other,
}

/// Reads the tokens before the cursor and decides which position they add up to.
fn place(tokens: &[TokenWithSpan]) -> Position {
    if tokens.is_empty() {
        return Position::StatementStart;
    }

    let verb = tokens.first().and_then(word).map(|word| word.keyword);

    // A forward pass: everything the decision needs is prefix state, and parentheses only match
    // reliably forwards.
    let mut group = Group::None;
    let mut stack: Vec<Group> = Vec::new();
    let mut group_start = 0usize;
    let mut group_starts: Vec<usize> = Vec::new();
    let mut clause: Option<Keyword> = None;
    // What the clause state was outside each open parenthesis, restored as it closes: a subquery
    // has clauses of its own, and `JOIN (SELECT ... FROM x) d` is still a join once it is over.
    let mut clauses: Vec<(Option<Keyword>, bool, bool)> = Vec::new();
    // Whether the table reference being read followed a JOIN, which is what makes `ON` legal.
    let mut joined = false;
    // Whether the clause is the `ON` or `USING` of a join, as opposed to the `ON` of, say, a
    // `CREATE INDEX`.
    let mut join_condition = false;
    // Whether the token before this one introduced a name, which makes this one a name however it
    // is spelled. sqlparser's keyword table is global, so `order`, `value` and `year` are all in
    // it and all perfectly ordinary table names.
    let mut naming = false;

    for at in 0..tokens.len() {
        match &tokens[at].token {
            Token::LParen => {
                let preceding = at.checked_sub(1).and_then(|before| word(&tokens[before]));
                let opened = match preceding.map(|word| word.keyword) {
                    Some(Keyword::OVER) => Group::Window,
                    Some(Keyword::CAST | Keyword::TRY_CAST | Keyword::SAFE_CAST) => Group::Cast,
                    _ if verb == Some(Keyword::CREATE) && stack.is_empty() => Group::Definition,
                    _ if verb == Some(Keyword::INSERT) && clause == Some(Keyword::INTO) => {
                        Group::Columns
                    }
                    _ if clause == Some(Keyword::VALUES) && group == Group::None => Group::Row,
                    _ => Group::Other,
                };
                stack.push(group);
                group_starts.push(group_start);
                clauses.push((clause, joined, join_condition));
                group = opened;
                group_start = at + 1;
                clause = None;
            }
            Token::RParen => {
                group = stack.pop().unwrap_or(Group::None);
                group_start = group_starts.pop().unwrap_or(0);
                (clause, joined, join_condition) = clauses.pop().unwrap_or((None, false, false));
            }
            Token::Word(word) if word.quote_style.is_none() && !naming => {
                if is_join_word(word.keyword) {
                    joined = true;
                    join_condition = false;
                    clause = Some(Keyword::JOIN);
                } else if let Some(keyword) = clause_keyword(word.keyword) {
                    join_condition = joined && matches!(keyword, Keyword::ON | Keyword::USING);
                    if keyword != Keyword::JOIN {
                        joined = false;
                    }
                    clause = Some(keyword);
                }
            }
            _ => {}
        }
        naming = word(&tokens[at])
            .map(|word| word.quote_style.is_none() && introduces_name(word.keyword))
            .unwrap_or(false);
    }

    let local = &tokens[group_start.min(tokens.len())..];
    decide(local, verb, group, clause, joined, join_condition)
}

/// The keywords that introduce a clause, and so say what the words after them mean.
fn clause_keyword(keyword: Keyword) -> Option<Keyword> {
    matches!(
        keyword,
        Keyword::SELECT
            | Keyword::FROM
            | Keyword::WHERE
            | Keyword::GROUP
            | Keyword::ORDER
            | Keyword::HAVING
            | Keyword::QUALIFY
            | Keyword::WINDOW
            | Keyword::LIMIT
            | Keyword::OFFSET
            | Keyword::SET
            | Keyword::VALUES
            | Keyword::INTO
            | Keyword::UPDATE
            | Keyword::RETURNING
            | Keyword::ON
            | Keyword::USING
    )
    .then_some(keyword)
}

/// Whether a word is part of the spelling of a join.
fn is_join_word(keyword: Keyword) -> bool {
    matches!(
        keyword,
        Keyword::JOIN
            | Keyword::INNER
            | Keyword::LEFT
            | Keyword::RIGHT
            | Keyword::FULL
            | Keyword::CROSS
            | Keyword::OUTER
            | Keyword::NATURAL
    )
}

/// The words that dictate what comes immediately after them.
fn obligatory(keyword: Keyword) -> Option<Position> {
    match keyword {
        Keyword::GROUP | Keyword::ORDER | Keyword::PARTITION => Some(Position::ExpectingBy),
        Keyword::LEFT
        | Keyword::RIGHT
        | Keyword::FULL
        | Keyword::INNER
        | Keyword::CROSS
        | Keyword::NATURAL
        | Keyword::OUTER => Some(Position::ExpectingJoin),
        Keyword::NULLS => Some(Position::ExpectingNullsOrder),
        Keyword::IS => Some(Position::ExpectingIsPredicate),
        _ => None,
    }
}

/// Which name a word that introduces one introduces: a table to read, the object of a DDL
/// statement, or a plain name.
fn name_after(keyword: Keyword, verb: Option<Keyword>) -> Position {
    match keyword {
        Keyword::FROM | Keyword::JOIN => Position::Name,
        Keyword::TABLE if verb.is_some_and(is_ddl_verb) => Position::ObjectName,
        _ => Position::Identifier,
    }
}

/// Whether a word introduces a name rather than continuing the grammar.
fn introduces_name(keyword: Keyword) -> bool {
    matches!(
        keyword,
        Keyword::FROM | Keyword::JOIN | Keyword::INTO | Keyword::UPDATE | Keyword::TABLE
    )
}

/// Whether a word may be read as a name, and so finishes a value.
///
/// Not [`crate::sources`]'s rule for the same question, though the two look alike: this one also
/// has to rule out the words that dictate what follows them (`IS`, `NULLS`, `PARTITION`), which
/// are perfectly good names to sources' scan. Deliberately not "is not a keyword", for the reason
/// [`crate::sources`] spells out at length:
/// sqlparser's keyword table is global and over a thousand entries, so ordinary names --
/// `warehouse`, `value`, `year`, `source` -- are in it. What has to be excluded is the handful of
/// words that mean something structural right here.
fn can_be_name(word: &Word) -> bool {
    word.quote_style.is_some()
        || !(clause_keyword(word.keyword).is_some()
            || is_join_word(word.keyword)
            || obligatory(word.keyword).is_some())
}

/// Whether a token finishes a value, so that what follows continues one rather than begins one.
fn completes_value(token: &Token) -> bool {
    match token {
        Token::Word(word) => can_be_name(word),
        Token::Number(_, _)
        | Token::SingleQuotedString(_)
        | Token::DoubleQuotedString(_)
        | Token::DollarQuotedString(_)
        | Token::NationalStringLiteral(_)
        | Token::HexStringLiteral(_)
        | Token::EscapedStringLiteral(_)
        | Token::RParen
        | Token::RBracket
        | Token::Placeholder(_) => true,
        // A wildcard finishes a select item; a multiplication does not, but the token before it
        // decides that and the caller has already looked.
        Token::Mul => true,
        _ => false,
    }
}

/// Decides the position from the tokens of the innermost group.
fn decide(
    local: &[TokenWithSpan],
    verb: Option<Keyword>,
    group: Group,
    clause: Option<Keyword>,
    joined: bool,
    join_condition: bool,
) -> Position {
    let Some(previous) = local.last() else {
        // Nothing typed inside the group yet.
        return match group {
            Group::Window => Position::WindowSpec,
            Group::Definition => Position::ColumnDefinition,
            Group::Columns => Position::Identifier,
            Group::Row => Position::Value,
            Group::Cast | Group::Other => Position::Subquery,
            Group::None => Position::StatementStart,
        };
    };

    // Whether the previous token stands where a name belongs, and so is a name whatever the
    // keyword table says about how it is spelled: `FROM order` is a table called `order`, not the
    // start of an `ORDER BY`.
    let previous_names = {
        let before = local.len().checked_sub(2);
        let after_introducer = before
            .and_then(|before| word(&local[before]))
            .map(|before| before.quote_style.is_none() && introduces_name(before.keyword))
            .unwrap_or(false);
        let after_dot = before
            .map(|before| matches!(local[before].token, Token::Period))
            .unwrap_or(false);
        matches!(previous.token, Token::Word(_)) && (after_introducer || after_dot)
    };

    if let Some(previous_word) = word(previous) {
        if previous_word.quote_style.is_none() && !previous_names {
            // A word that dictates what follows it wins over everything below.
            if let Some(position) = obligatory(previous_word.keyword) {
                return position;
            }
            if introduces_name(previous_word.keyword) || previous_word.keyword == Keyword::AS {
                return match group {
                    // The `AS` of a cast, and of a column definition, take a type rather than a
                    // name.
                    Group::Cast | Group::Definition => Position::ColumnDefinition,
                    _ => name_after(previous_word.keyword, verb),
                };
            }
            // Checked before the `DISTINCT` of a select below: `UNION DISTINCT` is the set
            // operator's, and the query after it has yet to begin.
            let set_operator = local
                .len()
                .checked_sub(2)
                .and_then(|before| word(&local[before]));
            if is_set_operator(previous_word.keyword)
                || (matches!(previous_word.keyword, Keyword::ALL | Keyword::DISTINCT)
                    && set_operator.is_some_and(|before| is_set_operator(before.keyword)))
            {
                return Position::SetOperand;
            }
            if previous_word.keyword == Keyword::SELECT
                || (matches!(previous_word.keyword, Keyword::DISTINCT | Keyword::ALL)
                    && clause == Some(Keyword::SELECT))
            {
                return Position::SelectStart;
            }
            // A modifier only counts inside a DDL statement: `OR` is a connective after `WHERE a
            // = 1`, and `temp` or `unique` is as likely to be a column as a modifier.
            if is_ddl_verb(previous_word.keyword)
                || (verb.is_some_and(is_ddl_verb) && is_ddl_modifier(previous_word.keyword))
            {
                return Position::Ddl;
            }
            // The `AND` of a frame's `BETWEEN` is followed by its second bound, not by a value.
            if group == Group::Window && previous_word.keyword == Keyword::AND {
                return Position::WindowSpec;
            }
            // What a `SET` assigns to is a column, not a value.
            if previous_word.keyword == Keyword::SET {
                return Position::Identifier;
            }
            // A count, which `starts_value` below would otherwise call a value -- and a value
            // is where columns are offered.
            let fetch = local
                .len()
                .checked_sub(2)
                .and_then(|before| word(&local[before]));
            if matches!(
                previous_word.keyword,
                Keyword::LIMIT | Keyword::OFFSET | Keyword::TOP
            ) || (matches!(previous_word.keyword, Keyword::FIRST | Keyword::NEXT)
                && fetch.is_some_and(|before| before.keyword == Keyword::FETCH))
            {
                return Position::RowCount;
            }
            if starts_value(previous_word.keyword) {
                return Position::Value;
            }
        }
    }

    match &previous.token {
        Token::Comma => {
            return match (group, clause) {
                (Group::Definition, _) | (Group::Columns, _) => Position::Identifier,
                (Group::None, Some(Keyword::SET)) => Position::Identifier,
                (_, Some(Keyword::FROM | Keyword::JOIN)) => Position::Name,
                (_, Some(Keyword::INTO | Keyword::UPDATE)) => Position::Identifier,
                // MySQL's `LIMIT offset, count`.
                (Group::None, Some(Keyword::LIMIT)) => Position::RowCount,
                _ => Position::Value,
            };
        }
        // Anything else that is not a completed value opens one. Inverted deliberately: sqlparser
        // has some eighty operator tokens and enumerating them would rot, whereas the tokens that
        // *finish* a value are a short, stable list.
        token if !previous_names && !completes_value(token) => return Position::Value,
        _ => {}
    }

    // A completed value. What it completes depends on the clause it sits in.
    match group {
        Group::Definition => return Position::ColumnDefinition,
        Group::Window => return Position::WindowSpec,
        _ => {}
    }

    match clause {
        Some(Keyword::ORDER) => Position::OrderItem,
        Some(Keyword::FROM) | Some(Keyword::JOIN) => {
            // Not an INSERT's target even in an INSERT: a FROM there belongs to the query the
            // rows come from.
            if joined {
                Position::JoinedItem
            } else {
                Position::TableItem
            }
        }
        Some(Keyword::INTO) => {
            if verb == Some(Keyword::INSERT) {
                Position::InsertTarget
            } else {
                Position::TableItem
            }
        }
        Some(Keyword::UPDATE) => Position::UpdateItem,
        Some(Keyword::SELECT) => Position::SelectItem,
        Some(Keyword::SET) if matches!(verb, Some(Keyword::UPDATE | Keyword::INSERT)) => {
            Position::Assignment
        }
        Some(Keyword::VALUES) if verb == Some(Keyword::INSERT) && group == Group::None => {
            Position::ValuesRow
        }
        Some(Keyword::ON | Keyword::USING) if join_condition => Position::JoinCondition,
        Some(
            Keyword::WHERE
            | Keyword::HAVING
            | Keyword::QUALIFY
            | Keyword::ON
            | Keyword::USING
            | Keyword::SET
            | Keyword::VALUES
            | Keyword::RETURNING
            | Keyword::GROUP
            | Keyword::LIMIT
            | Keyword::OFFSET
            | Keyword::WINDOW,
        ) => Position::Expression,
        // A `WITH` body that has closed leaves the statement still to be written.
        _ if verb == Some(Keyword::WITH) && matches!(previous.token, Token::RParen) => {
            Position::StatementStart
        }
        _ if verb == Some(Keyword::SELECT) => Position::SelectItem,
        _ => Position::Everything,
    }
}

/// Whether a word begins a value rather than continuing one.
fn starts_value(keyword: Keyword) -> bool {
    matches!(
        keyword,
        Keyword::AND
            | Keyword::OR
            | Keyword::NOT
            | Keyword::WHERE
            | Keyword::HAVING
            | Keyword::QUALIFY
            | Keyword::ON
            | Keyword::SET
            | Keyword::BY
            | Keyword::RETURNING
            | Keyword::WHEN
            | Keyword::THEN
            | Keyword::ELSE
            | Keyword::LIMIT
            | Keyword::OFFSET
            | Keyword::VALUES
            | Keyword::USING
    )
}

/// Whether a word combines one query with another.
fn is_set_operator(keyword: Keyword) -> bool {
    matches!(
        keyword,
        Keyword::UNION | Keyword::INTERSECT | Keyword::EXCEPT | Keyword::MINUS
    )
}

fn is_ddl_verb(keyword: Keyword) -> bool {
    matches!(
        keyword,
        Keyword::CREATE | Keyword::ALTER | Keyword::DROP | Keyword::TRUNCATE
    )
}

fn is_ddl_modifier(keyword: Keyword) -> bool {
    matches!(
        keyword,
        Keyword::TEMPORARY | Keyword::TEMP | Keyword::UNIQUE | Keyword::MATERIALIZED | Keyword::OR
    )
}

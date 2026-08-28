/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

//! The request and response types the analyzer is driven with.
//!
//! One JSON object in, one JSON object out. Deliberately narrow: everything here is about the
//! *text* -- what it parses to, where its names sit -- and nothing about the user's data
//! connections. Matching a name against a schema stays on the TypeScript side, which is where the
//! schema arrives and where the settings that decide what to do with a match live.
//!
//! Absent values are left out of the response rather than sent as `null`, so that a field the
//! TypeScript side declares optional really does read as `undefined` there.

use serde::{Deserialize, Serialize};

use crate::{cursor, dialects, diagnostics, keywords, scopes, sources, statements, text::TextIndex};

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum Request {
    /// Split a document into statements. Answers the statement range provider, which runs on the
    /// user's keystroke when they execute code and cannot wait for anything.
    Statements { text: String, #[serde(default)] dialect: String },
    /// Parse a document: its syntax errors, and every name it refers to.
    Analyze { text: String, #[serde(default)] dialect: String },
    /// The tables and names the statement at an offset can see from there.
    Sources { text: String, #[serde(default)] dialect: String, offset: u32 },
    /// The keywords worth completing, whatever the position: the caller's fallback for a prefix
    /// that matches nothing offered at the cursor.
    Keywords,
    /// The keywords worth completing at an offset, which is nearly always a much shorter list.
    KeywordsAt { text: String, #[serde(default)] dialect: String, offset: u32 },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatementSpan {
    pub start: u32,
    pub end: u32,
    pub terminated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub start: u32,
    pub end: u32,
    pub message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableRef {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schema: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub catalog: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alias: Option<String>,
    pub start: u32,
    pub end: u32,
    pub scope: u32,
    /// A name the statement defines for itself -- a CTE or a derived table -- rather than a table
    /// in the database.
    pub local: bool,
    /// The object a `CREATE` is defining, which does not exist in the schema yet by construction.
    pub definition: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnRef {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub qualifier: Option<String>,
    pub start: u32,
    pub end: u32,
    pub scope: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Scope {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<u32>,
    /// Indices into `tables` of the real tables this scope reads from.
    pub tables: Vec<u32>,
    /// Whether the scope reads from something whose columns cannot be known. A column here must
    /// not be judged: it may belong to the part that cannot be seen.
    pub opaque: bool,
    /// The names the statement defines at this level -- CTEs, derived table aliases, and the
    /// names those are read under. A column qualified by one of these names no more refers to a
    /// table in the database than the name itself does.
    pub locals: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceRef {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schema: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub catalog: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alias: Option<String>,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Response {
    Statements { statements: Vec<StatementSpan> },
    // `rename_all` on the enum renames the variants, not their fields, so the field naming has
    // to be spelled out on the variant that has more than one word in a field name.
    #[serde(rename_all = "camelCase")]
    Analyze {
        diagnostics: Vec<Diagnostic>,
        scopes: Vec<Scope>,
        tables: Vec<TableRef>,
        columns: Vec<ColumnRef>,
        /// Whether the configured dialect was not recognized, and the document was parsed
        /// without one. Reported so the caller can say so rather than leave the user wondering
        /// why their dialect's syntax is being flagged.
        unknown_dialect: bool,
    },
    Sources {
        sources: Vec<SourceRef>,
        /// The names the statement defines for itself that the cursor can refer to: CTEs, derived
        /// table aliases, and the names those are read under. Always empty when `origin` is
        /// `tokens`, which cannot tell one from a real table.
        locals: Vec<String>,
        /// Whether the cursor can see something whose columns cannot be known. A column completed
        /// here may belong to the part that cannot be seen, so the caller must not judge it.
        opaque: bool,
        /// How the answer was reached: `parsed` when the statement parsed with the cursor filled
        /// in, and the tables are the ones the cursor can actually see; `tokens` when it did not,
        /// and they are every table the statement mentions. For the caller's log, not for logic.
        origin: String,
    },
    Keywords { keywords: Vec<String> },
    // `rename_all` on the enum renames the variants rather than their fields, so a variant with a
    // second field has to say so itself.
    #[serde(rename_all = "camelCase")]
    KeywordsAt {
        keywords: Vec<String>,
        /// The position the scan decided the cursor is in. A heuristic answer, and a surprising
        /// one is otherwise indistinguishable from a broken one, so the caller can log which rule
        /// fired.
        position: String,
    },
    /// The request itself could not be understood. Never the user's SQL being wrong -- that is a
    /// diagnostic -- so it means the two sides have drifted apart.
    Error { message: String },
}

pub fn handle(request: &str) -> Response {
    let request: Request = match serde_json::from_str(request) {
        Ok(request) => request,
        Err(error) => return Response::Error { message: error.to_string() },
    };

    match request {
        Request::Keywords => Response::Keywords { keywords: keywords::everything() },

        Request::KeywordsAt { text, dialect, offset } => {
            let canonical = dialects::canonical(&dialect).unwrap_or("generic");
            let (dialect, _) = dialects::resolve(&dialect);
            let index = TextIndex::new(&text);
            let tokenized = statements::split(&text, dialect.as_ref(), &index);
            let statement = statements::statement_at(&tokenized.statements, offset);
            let position = keywords::at(statement, offset, &index);
            Response::KeywordsAt {
                keywords: keywords::offered(position, canonical),
                position: position.name().to_string(),
            }
        }

        Request::Statements { text, dialect } => {
            let (dialect, _) = dialects::resolve(&dialect);
            let index = TextIndex::new(&text);
            let tokenized = statements::split(&text, dialect.as_ref(), &index);
            Response::Statements {
                statements: tokenized
                    .statements
                    .iter()
                    .map(|statement| StatementSpan {
                        start: statement.start,
                        end: statement.end,
                        terminated: statement.terminated,
                    })
                    .collect(),
            }
        }

        Request::Analyze { text, dialect } => {
            let (dialect, known) = dialects::resolve(&dialect);
            let index = TextIndex::new(&text);
            let tokenized = statements::split(&text, dialect.as_ref(), &index);
            let parsed = diagnostics::parse(&tokenized, dialect.as_ref(), &index);
            Response::Analyze {
                diagnostics: parsed
                    .diagnostics
                    .into_iter()
                    .map(|diagnostic| Diagnostic {
                        start: diagnostic.start,
                        end: diagnostic.end,
                        message: diagnostic.message,
                    })
                    .collect(),
                scopes: parsed
                    .analysis
                    .scopes
                    .into_iter()
                    .map(|scope| Scope {
                        parent: scope.parent,
                        tables: scope.tables,
                        opaque: scope.opaque,
                        locals: scope.locals,
                    })
                    .collect(),
                tables: parsed.analysis.tables.into_iter().map(to_table).collect(),
                columns: parsed
                    .analysis
                    .columns
                    .into_iter()
                    .map(|column| ColumnRef {
                        name: column.name,
                        qualifier: column.qualifier,
                        start: column.start,
                        end: column.end,
                        scope: column.scope,
                    })
                    .collect(),
                unknown_dialect: !known,
            }
        }

        Request::Sources { text, dialect, offset } => {
            let (dialect, _) = dialects::resolve(&dialect);
            let index = TextIndex::new(&text);
            let tokenized = statements::split(&text, dialect.as_ref(), &index);
            let statement = statements::statement_at(&tokenized.statements, offset);

            // Parsing the statement with the cursor filled in is what makes the answer a scope
            // rather than a list, so it is tried first. When half typed SQL defeats even that, the
            // token scan still knows which tables the statement mentions, which is the answer that
            // was being given before there was anything better.
            let found = statement
                .and_then(|statement| cursor::at(statement, offset, dialect.as_ref(), &index));
            let (found, origin) = match found {
                Some(found) => (found, "parsed"),
                None => (
                    cursor::AtCursor {
                        sources: statement.map(|at| sources::scan(&at.tokens)).unwrap_or_default(),
                        locals: Vec::new(),
                        opaque: false,
                    },
                    "tokens",
                ),
            };

            Response::Sources {
                sources: found
                    .sources
                    .into_iter()
                    .map(|source| SourceRef {
                        name: source.name,
                        schema: source.schema,
                        catalog: source.catalog,
                        alias: source.alias,
                    })
                    .collect(),
                locals: found.locals,
                opaque: found.opaque,
                origin: origin.to_string(),
            }
        }
    }
}

fn to_table(table: scopes::TableRef) -> TableRef {
    TableRef {
        name: table.name,
        schema: table.schema,
        catalog: table.catalog,
        alias: table.alias,
        start: table.start,
        end: table.end,
        scope: table.scope,
        local: table.local,
        definition: table.definition,
    }
}

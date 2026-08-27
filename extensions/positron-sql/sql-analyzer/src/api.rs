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

use crate::{dialects, diagnostics, scopes, sources, statements, text::TextIndex};

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum Request {
    /// Split a document into statements. Answers the statement range provider, which runs on the
    /// user's keystroke when they execute code and cannot wait for anything.
    Statements { text: String, #[serde(default)] dialect: String },
    /// Parse a document: its syntax errors, and every name it refers to.
    Analyze { text: String, #[serde(default)] dialect: String },
    /// The tables named by the statement at an offset, read off the tokens rather than a tree.
    Sources { text: String, #[serde(default)] dialect: String, offset: u32 },
    /// The keywords worth completing.
    Keywords,
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
    Sources { sources: Vec<SourceRef> },
    Keywords { keywords: Vec<String> },
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
        Request::Keywords => Response::Keywords { keywords: dialects::keywords() },

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
            let found = statements::statement_at(&tokenized.statements, offset)
                .map(|statement| sources::scan(&statement.tokens))
                .unwrap_or_default();
            Response::Sources {
                sources: found
                    .into_iter()
                    .map(|source| SourceRef {
                        name: source.name,
                        schema: source.schema,
                        catalog: source.catalog,
                        alias: source.alias,
                    })
                    .collect(),
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

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

//! Finding the table and column names a statement refers to, and the scope each one sits in.
//!
//! Shared by the two features that need to know what a name in the document points at:
//! diagnostics for names the connected database does not have, and document links that reveal a
//! name in the Data Connections pane. Neither is decided here -- this module knows nothing about
//! the user's schema. It reports what the *statement* says: which real tables each scope reads
//! from, which names the statement defines for itself, and which scope every column sits in.
//! Matching that against a schema is the caller's job.
//!
//! Scopes are tracked rather than sweeping the statement flat because the two disagree in a case
//! that is ordinary SQL: in `WITH recent AS (SELECT id FROM orders) SELECT x FROM recent`, a flat
//! sweep would judge `x` against `orders`, which the outer select cannot see at all.

use std::collections::HashSet;
use std::ops::ControlFlow;

use sqlparser::ast::{
    AssignmentTarget, Expr, Ident, ObjectName, ObjectNamePart, ObjectType, Query, Select,
    SelectItem, Statement, TableFactor, TableWithJoins, Visit, Visitor,
};

use crate::text::TextIndex;

/// One real table named by the statement, and where it sits.
pub struct TableRef {
    pub name: String,
    pub schema: Option<String>,
    pub catalog: Option<String>,
    /// What the statement called it, when it gave it an alias.
    pub alias: Option<String>,
    /// Offsets of the table's own name: its qualifier is excluded, its quotes are not.
    pub start: u32,
    pub end: u32,
    /// The scope this reference was found in.
    pub scope: u32,
    /// Whether the name is one the statement defines for itself -- a CTE or a derived table --
    /// rather than a table in the database. Referring to one is correct SQL and must never be
    /// reported as unknown.
    pub local: bool,
    /// Whether this is the object a `CREATE` statement is defining, which by definition does not
    /// exist in the schema yet and must not be reported as missing.
    pub definition: bool,
}

/// One column named by the statement.
pub struct ColumnRef {
    pub name: String,
    /// The table or alias the column was qualified with, if any.
    pub qualifier: Option<String>,
    /// Offsets of the column's own name: its qualifier is excluded, its quotes are not.
    pub start: u32,
    pub end: u32,
    pub scope: u32,
}

/// One naming scope: what a column written here can be resolved against.
pub struct Scope {
    pub parent: Option<u32>,
    /// Indices into [`Analysis::tables`] of the real tables this scope reads from.
    pub tables: Vec<u32>,
    /// Whether the scope reads from something whose columns cannot be known -- a derived table, a
    /// VALUES list, an UNNEST, a table function. A column in such a scope may belong to the part
    /// that cannot be seen, so the caller must not judge it.
    pub opaque: bool,
    /// Names the statement defines at this level: CTEs and derived table aliases.
    pub locals: Vec<String>,
}

#[derive(Default)]
pub struct Analysis {
    pub scopes: Vec<Scope>,
    pub tables: Vec<TableRef>,
    pub columns: Vec<ColumnRef>,
}

/// Collects the scopes, tables and columns of one parsed statement.
pub fn analyze(statements: &[Statement], index: &TextIndex) -> Analysis {
    let mut collector = Collector::new(index);
    // The root scope, which holds the relations of statements that have no SELECT of their own:
    // the target of an UPDATE or a DELETE, say, whose columns resolve against it.
    collector.push(None, Vec::new());
    for statement in statements {
        let _ = statement.visit(&mut collector);
    }
    collector.finish()
}

struct Collector<'a> {
    index: &'a TextIndex,
    analysis: Analysis,
    /// The open scopes, innermost last.
    stack: Vec<u32>,
    /// Spans of relations already recorded, so a table pre-scanned out of a FROM clause is not
    /// recorded a second time when the traversal reaches it.
    seen: HashSet<(u32, u32)>,
    /// Spans of the objects a CREATE statement defines.
    definitions: HashSet<(u32, u32)>,
}

impl<'a> Collector<'a> {
    fn new(index: &'a TextIndex) -> Self {
        Self {
            index,
            analysis: Analysis::default(),
            stack: Vec::new(),
            seen: HashSet::new(),
            definitions: HashSet::new(),
        }
    }

    fn finish(self) -> Analysis {
        self.analysis
    }

    fn current(&self) -> u32 {
        self.stack.last().copied().unwrap_or(0)
    }

    fn push(&mut self, parent: Option<u32>, locals: Vec<String>) -> u32 {
        let id = self.analysis.scopes.len() as u32;
        self.analysis.scopes.push(Scope { parent, tables: Vec::new(), opaque: false, locals });
        self.stack.push(id);
        id
    }

    fn pop(&mut self) {
        self.stack.pop();
    }

    /// Whether a name is one the statement defines for itself, anywhere up the scope chain.
    fn is_local(&self, name: &str) -> bool {
        let folded = fold(name);
        let mut scope = Some(self.current());
        while let Some(id) = scope {
            let entry = &self.analysis.scopes[id as usize];
            if entry.locals.iter().any(|local| fold(local) == folded) {
                return true;
            }
            scope = entry.parent;
        }
        false
    }

    /// Records a real table reference, and returns its index when it is one worth resolving.
    fn record_table(&mut self, name: &ObjectName, alias: Option<String>) -> Option<u32> {
        let parts: Vec<&Ident> = name.0.iter().filter_map(|part| part.as_ident()).collect();
        let last = parts.last()?;
        // A node the parser synthesized rather than read from the text carries no position, and a
        // name with no position cannot be squiggled or linked.
        let (start, end) = self.index.span(last.span)?;
        if !self.seen.insert((start, end)) {
            return None;
        }

        // A dotted name is read from the right: the last part is the table, the one before it
        // the schema, the one before that the catalog. A name with fewer parts simply says less.
        let part = |back: usize| {
            parts.len().checked_sub(back).and_then(|at| parts.get(at)).map(|part| part.value.clone())
        };
        let table = TableRef {
            name: last.value.clone(),
            schema: part(2),
            catalog: part(3),
            alias,
            start,
            end,
            scope: self.current(),
            local: parts.len() == 1 && self.is_local(&last.value),
            definition: self.definitions.contains(&(start, end)),
        };
        let index = self.analysis.tables.len() as u32;
        self.analysis.tables.push(table);
        Some(index)
    }

    /// Adds a scope's own FROM clause to it, before any expression in the scope is visited.
    ///
    /// Needed because a `Select` holds its projection before its `from`, so the traversal reaches
    /// `SELECT total` well before it reaches the `FROM orders` that says what `total` belongs to.
    fn scan_from(&mut self, from: &[TableWithJoins]) {
        for entry in from {
            self.scan_factor(&entry.relation);
            for join in &entry.joins {
                self.scan_factor(&join.relation);
            }
        }
    }

    fn scan_factor(&mut self, factor: &TableFactor) {
        match factor {
            // A table-valued function (`FROM generate_series(...)`) names nothing in the schema
            // and produces columns that cannot be known.
            TableFactor::Table { args: Some(_), name, alias, .. } => {
                self.mark_seen(name);
                self.mark_opaque(alias.as_ref().map(|alias| alias.name.value.clone()));
            }
            TableFactor::Table { name, alias, .. } => {
                let alias = alias.as_ref().map(|alias| alias.name.value.clone());
                if let Some(index) = self.record_table(name, alias) {
                    let scope = self.current();
                    if self.analysis.tables[index as usize].local {
                        // A CTE or derived table read by name: its columns are whatever its own
                        // select list produced, which this cannot see. The name it is read under
                        // is recorded so a column qualified by it is left alone too.
                        self.analysis.scopes[scope as usize].opaque = true;
                        let local = self.analysis.tables[index as usize]
                            .alias
                            .clone()
                            .unwrap_or_else(|| self.analysis.tables[index as usize].name.clone());
                        self.analysis.scopes[scope as usize].locals.push(local);
                    } else {
                        self.analysis.scopes[scope as usize].tables.push(index);
                    }
                }
            }
            // A nested join is still this scope's sources, one bracket deeper.
            TableFactor::NestedJoin { table_with_joins, alias } => {
                if let Some(alias) = alias {
                    self.add_local(alias.name.value.clone());
                }
                self.scan_from(std::slice::from_ref(table_with_joins));
            }
            other => {
                if let Some(name) = function_name(other) {
                    self.mark_seen(name);
                }
                self.mark_opaque(alias_of(other));
            }
        }
    }

    /// Claims a name's span without recording it, so the traversal that reaches the same name
    /// later does not record it as a real table.
    fn mark_seen(&mut self, name: &ObjectName) {
        if let Some(last) = name.0.iter().filter_map(ObjectNamePart::as_ident).next_back() {
            if let Some(span) = self.index.span(last.span) {
                self.seen.insert(span);
            }
        }
    }

    /// Marks the current scope as holding something whose columns cannot be known, and registers
    /// the name it was given so a reference to that name is not mistaken for a real table.
    fn mark_opaque(&mut self, alias: Option<String>) {
        let scope = self.current();
        self.analysis.scopes[scope as usize].opaque = true;
        if let Some(alias) = alias {
            self.analysis.scopes[scope as usize].locals.push(alias);
        }
    }

    /// Records the column an UPDATE assigns to.
    fn record_assigned(&mut self, name: &ObjectName) {
        let parts: Vec<&Ident> = name.0.iter().filter_map(ObjectNamePart::as_ident).collect();
        let Some(last) = parts.last() else { return };
        let Some((start, end)) = self.index.span(last.span) else { return };
        self.analysis.columns.push(ColumnRef {
            name: last.value.clone(),
            qualifier: parts.iter().rev().nth(1).map(|part| part.value.clone()),
            start,
            end,
            scope: self.current(),
        });
    }

    fn add_local(&mut self, name: String) {
        let scope = self.current();
        self.analysis.scopes[scope as usize].locals.push(name);
    }

    /// Hands a scope's sources up to its parent as the scope closes.
    ///
    /// A query's `ORDER BY`, `LIMIT` and `OFFSET` sit on the query rather than on the select
    /// inside it, and the traversal reaches them after the select has closed -- so without this
    /// they would land in a scope that reads from nothing, and every column in an `ORDER BY` would
    /// look like a column of no table. What they can actually name is what the select reads from,
    /// which is exactly what is lifted here.
    ///
    /// `produced` are the names the select list gives its own results. Those go up as locals
    /// rather than as tables, because `ORDER BY t` after `SELECT total AS t` names neither a
    /// column of a table nor a mistake: it names something the statement made up, and a caller
    /// looking it up in the schema would find nothing and be wrong to say so.
    fn lift(&mut self, from: u32, produced: Vec<String>) {
        let Some(parent) = self.analysis.scopes[from as usize].parent else { return };
        let tables = self.analysis.scopes[from as usize].tables.clone();
        let locals = self.analysis.scopes[from as usize].locals.clone();
        let opaque = self.analysis.scopes[from as usize].opaque;
        let into = &mut self.analysis.scopes[parent as usize];
        into.tables.extend(tables);
        into.locals.extend(locals);
        into.locals.extend(produced);
        into.opaque |= opaque;
    }
}

/// The names a select list gives its own results.
///
/// Only the ones it made up. An item written without an alias is named after the column it reads,
/// which resolves against a table like any other name and needs no help.
fn produced(select: &Select) -> Vec<String> {
    select
        .projection
        .iter()
        .filter_map(|item| match item {
            SelectItem::ExprWithAlias { alias, .. } => Some(alias.value.clone()),
            _ => None,
        })
        .collect()
}

/// The alias a table factor was given, for the forms that only ever produce local names.
fn alias_of(factor: &TableFactor) -> Option<String> {
    let alias = match factor {
        TableFactor::Derived { alias, .. }
        | TableFactor::TableFunction { alias, .. }
        | TableFactor::Function { alias, .. }
        | TableFactor::UNNEST { alias, .. }
        | TableFactor::JsonTable { alias, .. }
        | TableFactor::OpenJsonTable { alias, .. }
        | TableFactor::XmlTable { alias, .. }
        | TableFactor::Pivot { alias, .. }
        | TableFactor::Unpivot { alias, .. }
        | TableFactor::MatchRecognize { alias, .. } => alias.as_ref(),
        _ => None,
    };
    alias.map(|alias| alias.name.value.clone())
}

/// The last identifier of a dotted name, which is the object it actually names.
fn last_ident(name: &ObjectName) -> Option<&Ident> {
    name.0.iter().filter_map(ObjectNamePart::as_ident).next_back()
}

/// The name of a table factor that is a function call rather than a table.
fn function_name(factor: &TableFactor) -> Option<&ObjectName> {
    match factor {
        TableFactor::TableFunction { .. } => None,
        TableFactor::Function { name, .. } => Some(name),
        _ => None,
    }
}

fn fold(name: &str) -> String {
    name.to_lowercase()
}

impl Visitor for Collector<'_> {
    type Break = ();

    fn pre_visit_statement(&mut self, statement: &Statement) -> ControlFlow<()> {
        // The object a CREATE names does not exist in the schema yet, by construction, so it is
        // recorded by span for the relation visit below to recognize. Only the forms that name
        // something new: a DROP or an ALTER names an object that has to exist already.
        let target: Option<&ObjectName> = match statement {
            Statement::CreateTable(create) => Some(&create.name),
            Statement::CreateView(create) => Some(&create.name),
            _ => None,
        };
        if let Some(last) = target.and_then(last_ident) {
            if let Some(span) = self.index.span(last.span) {
                self.definitions.insert(span);
            }
        }

        // An UPDATE's `SET` targets are object names rather than expressions, so the expression
        // visit never reaches them, but they are columns of the table being updated and resolve
        // against it like any other.
        if let Statement::Update(update) = statement {
            for assignment in &update.assignments {
                match &assignment.target {
                    AssignmentTarget::ColumnName(name) => self.record_assigned(name),
                    AssignmentTarget::Tuple(names) => {
                        names.iter().for_each(|name| self.record_assigned(name));
                    }
                }
            }
        }

        // A DROP holds its objects in a field the visitor does not treat as a relation, so they
        // are picked up here instead. Unlike a CREATE's target, they have to exist.
        if let Statement::Drop { object_type, names, .. } = statement {
            if matches!(object_type, ObjectType::Table | ObjectType::View) {
                for name in names {
                    if let Some(at) = self.record_table(name, None) {
                        let scope = self.current();
                        self.analysis.scopes[scope as usize].tables.push(at);
                    }
                }
            }
        }

        ControlFlow::Continue(())
    }

    fn pre_visit_query(&mut self, query: &Query) -> ControlFlow<()> {
        // A CTE's name is visible to the query that declares it, and to the later CTEs beside it,
        // so every name in the WITH clause is collected before any of them is visited.
        let locals = query
            .with
            .iter()
            .flat_map(|with| with.cte_tables.iter())
            .map(|cte| cte.alias.name.value.clone())
            .collect();
        self.push(self.stack.last().copied(), locals);
        ControlFlow::Continue(())
    }

    fn post_visit_query(&mut self, _query: &Query) -> ControlFlow<()> {
        self.pop();
        ControlFlow::Continue(())
    }

    fn pre_visit_select(&mut self, select: &Select) -> ControlFlow<()> {
        // A scope of its own rather than the enclosing query's, so that the two halves of a
        // `SELECT a FROM t UNION SELECT b FROM u` are judged against their own FROM clause.
        self.push(self.stack.last().copied(), Vec::new());
        self.scan_from(&select.from);
        ControlFlow::Continue(())
    }

    fn post_visit_select(&mut self, select: &Select) -> ControlFlow<()> {
        if let Some(scope) = self.stack.last().copied() {
            self.lift(scope, produced(select));
        }
        self.pop();
        ControlFlow::Continue(())
    }

    fn pre_visit_relation(&mut self, relation: &ObjectName) -> ControlFlow<()> {
        // Everything a FROM clause holds was recorded by the pre-scan above and is skipped here
        // by its span. What reaches this is the rest: the target of an INSERT, UPDATE or DELETE,
        // and the objects named by DDL -- all of which resolve columns for their statement, so
        // they join the current scope's tables the same way a FROM entry would.
        if let Some(index) = self.record_table(relation, None) {
            let scope = self.current();
            if !self.analysis.tables[index as usize].local {
                self.analysis.scopes[scope as usize].tables.push(index);
            }
        }
        ControlFlow::Continue(())
    }

    fn pre_visit_expr(&mut self, expr: &Expr) -> ControlFlow<()> {
        let (qualifier, ident) = match expr {
            Expr::Identifier(ident) => (None, ident),
            Expr::CompoundIdentifier(parts) => match parts.as_slice() {
                [.., qualifier, ident] => (Some(qualifier.value.clone()), ident),
                _ => return ControlFlow::Continue(()),
            },
            _ => return ControlFlow::Continue(()),
        };

        if let Some((start, end)) = self.index.span(ident.span) {
            self.analysis.columns.push(ColumnRef {
                name: ident.value.clone(),
                qualifier,
                start,
                end,
                scope: self.current(),
            });
        }
        ControlFlow::Continue(())
    }
}

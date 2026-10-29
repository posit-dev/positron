/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

//! Whether a name can be written bare, or has to be quoted to be read as a name.
//!
//! Completion inserts the names of tables and columns, and a name that happens to be a keyword --
//! a column called `order`, a table called `user` -- is a syntax error, or worse a different
//! meaning, when it is written bare. Which keywords those are differs by dialect and by where the
//! name stands. So a keyword is quoted when sqlparser holds it reserved, and otherwise tried:
//! written where a completion puts a name, it has to come back out of the parser as that name.
//!
//! Erring towards quoting is safe. A completion inserts the name exactly as the connection
//! reported it, so a quoted one always names the right object; an unquoted keyword may not parse.
//! Case is not judged here: whether `Customers` survives being written bare is a question of how
//! the engine folds case, which the caller knows from the dialect.

use sqlparser::ast::{Expr, SelectItem, SetExpr, Statement, TableFactor};
use sqlparser::dialect::Dialect;
use sqlparser::keywords::{self, Keyword};
use sqlparser::parser::Parser;
use sqlparser::tokenizer::{Token, Tokenizer};

use crate::diagnostics::RECURSION_LIMIT;

/// Whether `name` has to be quoted to be read as a table or column name in `dialect`.
pub fn needs_quotes(name: &str, dialect: &dyn Dialect) -> bool {
    if !is_bare(name) {
        return true;
    }
    let Ok(tokens) = Tokenizer::new(dialect, name).tokenize() else {
        return true;
    };
    let significant: Vec<&Token> = tokens
        .iter()
        .filter(|token| !matches!(token, Token::Whitespace(_)))
        .collect();
    match significant.as_slice() {
        [Token::Word(word)] if word.keyword == Keyword::NoKeyword => false,
        [Token::Word(word)] => {
            is_reserved(word.keyword, dialect)
                || !(reads_as_column(name, dialect)
                    && reads_as_filter(name, dialect)
                    && reads_as_table(name, dialect))
        }
        _ => true,
    }
}

/// Whether sqlparser itself treats a keyword as one that cannot name anything.
///
/// Needed alongside the trial parses because sqlparser is more forgiving than the engines it
/// parses for: it reads `SELECT order FROM t` as a column called `order` in every dialect, where
/// every engine rejects it. The keywords it refuses as an alias are the ones that start or end a
/// clause, which is what makes them reserved on the engines too.
fn is_reserved(keyword: Keyword, dialect: &dyn Dialect) -> bool {
    keywords::RESERVED_FOR_COLUMN_ALIAS.contains(&keyword)
        || keywords::RESERVED_FOR_TABLE_ALIAS.contains(&keyword)
        || dialect.is_reserved_for_identifier(keyword)
}

/// Letters, digits and underscores, not starting with a digit: the one spelling every dialect
/// reads as an identifier, when it is not a keyword.
fn is_bare(name: &str) -> bool {
    let mut characters = name.chars();
    characters
        .next()
        .is_some_and(|first| first.is_ascii_alphabetic() || first == '_')
        && characters.all(|character| character.is_ascii_alphanumeric() || character == '_')
}

fn parse(sql: &str, dialect: &dyn Dialect) -> Option<Statement> {
    let mut parsed = Parser::new(dialect)
        .with_recursion_limit(RECURSION_LIMIT)
        .try_with_sql(sql)
        .ok()?
        .parse_statements()
        .ok()?;
    (parsed.len() == 1).then(|| parsed.remove(0))
}

fn is_name(expr: &Expr, name: &str) -> bool {
    matches!(expr, Expr::Identifier(ident) if ident.value == name && ident.quote_style.is_none())
}

/// `SELECT name FROM t` reads `name` as a column, and not as a function such as `CURRENT_USER`.
fn reads_as_column(name: &str, dialect: &dyn Dialect) -> bool {
    let Some(Statement::Query(query)) = parse(&format!("SELECT {name} FROM t"), dialect) else {
        return false;
    };
    let SetExpr::Select(select) = query.body.as_ref() else {
        return false;
    };
    matches!(select.projection.as_slice(), [SelectItem::UnnamedExpr(expr)] if is_name(expr, name))
}

/// `WHERE name = 1` reads `name` as a column, and not as the start of a typed literal.
fn reads_as_filter(name: &str, dialect: &dyn Dialect) -> bool {
    let Some(Statement::Query(query)) =
        parse(&format!("SELECT a FROM t WHERE {name} = 1"), dialect)
    else {
        return false;
    };
    let SetExpr::Select(select) = query.body.as_ref() else {
        return false;
    };
    matches!(&select.selection, Some(Expr::BinaryOp { left, .. }) if is_name(left, name))
}

/// `FROM name` reads `name` as a table, and not as the keyword that starts a join or a clause.
fn reads_as_table(name: &str, dialect: &dyn Dialect) -> bool {
    let Some(Statement::Query(query)) = parse(&format!("SELECT a FROM {name}"), dialect) else {
        return false;
    };
    let SetExpr::Select(select) = query.body.as_ref() else {
        return false;
    };
    match select.from.as_slice() {
        [entry] if entry.joins.is_empty() => matches!(
            &entry.relation,
            TableFactor::Table { name: table, alias: None, args: None, .. }
                if table.0.len() == 1
                    && table.0[0]
                        .as_ident()
                        .is_some_and(|ident| ident.value == name && ident.quote_style.is_none())
        ),
        _ => false,
    }
}

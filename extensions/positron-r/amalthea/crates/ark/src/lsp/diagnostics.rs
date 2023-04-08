//
// diagnostics.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

use std::sync::atomic::AtomicI32;
use std::time::Duration;

use stdext::unwrap;
use tower_lsp::lsp_types::Diagnostic;
use tower_lsp::lsp_types::DiagnosticSeverity;
use tower_lsp::lsp_types::Url;
use tree_sitter::Node;

use crate::lsp::backend::Backend;
use crate::lsp::traits::cursor::TreeCursorExt;
use crate::Range;

static VERSION: AtomicI32 = AtomicI32::new(0);

pub async fn enqueue_diagnostics(backend: Backend, uri: Url, version: i32) {
    // check diagnostics version
    let current_version = VERSION.load(std::sync::atomic::Ordering::Acquire);
    if version < current_version {
        return;
    }

    // store the new version
    VERSION.store(version, std::sync::atomic::Ordering::Release);

    // spawn a new task
    tokio::spawn(async move {
        // wait some amount of time
        tokio::time::sleep(Duration::from_secs(1)).await;

        // check for cancellation
        let current_version = VERSION.load(std::sync::atomic::Ordering::Acquire);
        if version != current_version {
            return;
        }

        // okay, it's our chance to provide diagnostics
        enqueue_diagnostics_impl(backend, uri).await;
    });
}

async fn enqueue_diagnostics_impl(backend: Backend, uri: Url) {
    let mut diagnostics: Vec<Diagnostic> = Vec::new();
    {
        // get reference to document
        let doc = unwrap!(backend.documents.get_mut(&uri), None => {
            log::error!("diagnostics: no document associated with uri {} available", uri);
            return;
        });

        let source = doc.contents.to_string();

        // iterate through nodes and scan
        let root = doc.ast.root_node();
        let mut cursor = root.walk();
        cursor.recurse(|node| {
            check_unmatched_bracket(node, &source, &mut diagnostics);
            check_invalid_na_comparison(node, &source, &mut diagnostics);
            check_unexpected_assignment_in_if_conditional(node, &source, &mut diagnostics);
            true
        });
    }

    if diagnostics.is_empty() {
        return;
    }

    backend
        .client
        .publish_diagnostics(uri, diagnostics, None)
        .await;
}

fn check_unmatched_bracket(node: Node, _source: &str, diagnostics: &mut Vec<Diagnostic>) -> bool {
    // A complete bracket node should normally have three children:
    //
    // - The opening bracket,
    // - The body of the bracket statement,
    // - The closing bracket.
    //
    // TODO: '[' and '[[' are special, as they require a node prior (since
    // they're used for subsetting). Similarly, we would need a separate way to
    // diagnose things like 'a(' where '(' is used for a call rather than just
    // stand-alone parentheses.
    let n = node.child_count();
    if n == 0 {
        return false;
    }

    let lhs = node.kind();
    if !matches!(lhs, "{" | "(" | "[" | "[[") {
        return false;
    }

    let rhs = match lhs {
        "{" => "}",
        "(" => ")",
        "[" => "]",
        "[[" => "]]",
        _ => return false,
    };

    let last_child = node.child(n - 1).unwrap();
    if last_child.kind() == rhs {
        return false;
    }

    let child = node.child(0).unwrap();
    let range: Range = child.range().into();
    let diagnostic = Diagnostic::new_simple(
        range.into(),
        format!("unmatched opening bracket '{}'", node.kind()),
    );
    diagnostics.push(diagnostic);

    true
}

fn check_invalid_na_comparison(
    node: Node,
    source: &str,
    diagnostics: &mut Vec<Diagnostic>,
) -> bool {
    let n = node.child_count();
    if n == 0 {
        return false;
    }

    if node.kind() != "==" {
        return false;
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        let contents = child.utf8_text(source.as_bytes()).unwrap();
        if matches!(contents, "NA" | "NaN" | "NULL") {
            let message = match contents {
                "NA" => "consider using `is.na()` to check NA values",
                "NaN" => "consider using `is.nan()` to check NaN values",
                "NULL" => "consider using `is.null()` to check NULL values",
                _ => continue,
            };
            let range: Range = child.range().into();
            let mut diagnostic = Diagnostic::new_simple(range.into(), message.into());
            diagnostic.severity = Some(DiagnosticSeverity::INFORMATION);
            diagnostics.push(diagnostic);
        }
    }

    true
}

fn check_unexpected_assignment_in_if_conditional(
    node: Node,
    _source: &str,
    diagnostics: &mut Vec<Diagnostic>,
) -> bool {
    let n = node.child_count();
    if n == 0 {
        return false;
    }

    let kind = node.kind();
    if kind != "if" {
        return false;
    }

    let condition = unwrap!(node.child_by_field_name("condition"), None => {
        return false;
    });

    if !matches!(condition.kind(), "=") {
        return false;
    }

    let range: Range = condition.range().into();
    let message = "unexpected '='; use '==' to compare values for equality";
    let diagnostic = Diagnostic::new_simple(range.into(), message.into());
    diagnostics.push(diagnostic);

    true
}

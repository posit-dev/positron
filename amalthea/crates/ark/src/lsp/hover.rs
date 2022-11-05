//
// hover.rs
//
// Copyright (C) 2022 by Posit, PBC
//
//

use anyhow::*;
use stdext::unwrap;
use stdext::unwrap::IntoResult;
use tower_lsp::lsp_types::MarkupContent;
use tower_lsp::lsp_types::MarkupKind;
use tree_sitter::Node;

use crate::lsp::completions::CompletionContext;
use crate::lsp::documents::Document;
use crate::lsp::help::RHtmlHelp;

enum HoverContext {
    Topic { topic: String },
    QualifiedTopic { package: String, topic: String },
}

fn hover_context(node: Node, context: &CompletionContext) -> Result<Option<HoverContext>> {

    // if the parent node is a namespace call, use that node instead
    // TODO: What if the user hovers the cursor over 'dplyr' in e.g. 'dplyr::mutate'?
    let mut node = node;
    if let Some(parent) = node.parent() {
        if matches!(parent.kind(), "::" | ":::") {
            node = parent;
        }
    }

    // if we have a namespace call, use that to provide a qualified topic
    if matches!(node.kind(), "::" | ":::") {

        let lhs = node.child_by_field_name("lhs").into_result()?;
        let rhs = node.child_by_field_name("rhs").into_result()?;

        let ok =
            matches!(lhs.kind(), "identifier" | "string") &&
            matches!(rhs.kind(), "identifier" | "string");

        if !ok {
            return Ok(None);
        }

        let package = lhs.utf8_text(context.source.as_bytes())?;
        let topic = rhs.utf8_text(context.source.as_bytes())?;
        return Ok(Some(HoverContext::QualifiedTopic {
            package: package.to_string(),
            topic: topic.to_string(),
        }));

    }

    // otherwise, check for an identifier or a string
    if matches!(node.kind(), "identifier" | "string" | "keyword") {

        // only provide documentation for function calls for now,
        // since bare identifiers might not match the topic we expect
        if let Some(parent) = node.parent() {
            if parent.kind() != "call" {
                return Ok(None);
            }
        }

        // otherwise, use it
        let topic = node.utf8_text(context.source.as_bytes())?;
        return Ok(Some(HoverContext::Topic { topic: topic.to_string() }))

    }

    Ok(None)

}

/// SAFETY: Requires access to the R runtime.
pub unsafe fn hover(_document: &Document, context: &CompletionContext) -> Result<Option<MarkupContent>> {

    // get the node
    let node = &context.node;

    // check for identifier
    if !matches!(node.kind(), "identifier" | "keyword" | "string") {
        return Ok(None);
    }

    let ctx = hover_context(*node, context)?;
    let ctx = unwrap!(ctx, None => {
        return Ok(None);
    });

    let help = match ctx {

        HoverContext::QualifiedTopic { package, topic } => {
            RHtmlHelp::new(topic.as_str(), Some(package.as_str()))?
        }

        HoverContext::Topic { topic } => {
            RHtmlHelp::new(topic.as_str(), None)?
        }

    };

    let help = unwrap!(help, None => {
        return Ok(None);
    });

    let markdown = help.markdown()?;
    Ok(Some(MarkupContent {
        kind: MarkupKind::Markdown,
        value: markdown,
    }))

}

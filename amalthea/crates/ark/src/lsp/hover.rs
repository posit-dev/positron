//
// hover.rs
//
// Copyright (C) 2022 by Posit, PBC
//
//

use anyhow::*;
use harp::exec::RFunction;
use harp::exec::RFunctionExt;
use log::info;
use scraper::Html;
use scraper::Selector;
use stdext::push;
use stdext::unwrap;
use stdext::unwrap::IntoResult;
use tower_lsp::lsp_types::MarkupContent;
use tower_lsp::lsp_types::MarkupKind;
use tree_sitter::Node;

use crate::lsp::completions::CompletionContext;
use crate::lsp::document::Document;
use crate::lsp::markdown::*;
use crate::lsp::markdown::md_newline;

enum HoverContext {
    Topic(String),
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

        if !matches!(lhs.kind(), "identifier" | "string") {
            bail!("Ignoring '::' call with lhs {}", lhs.to_sexp());
        }

        if !matches!(rhs.kind(), "identifier" | "string") {
            bail!("Ignoring '::' call with rhs {}", rhs.to_sexp());
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

        // bail if we're in an extraction operator
        if let Some(parent) = node.parent() {
            if matches!(parent.kind(), "$" | "@") {
                bail!("ignoring identifier in extraction operator");
            }
        }

        // otherwise, use it
        let topic = node.utf8_text(context.source.as_bytes())?;
        return Ok(Some(HoverContext::Topic(topic.to_string())));

    }

    Ok(None)

}

/// SAFETY: Requires access to the R runtime.
pub unsafe fn hover(_document: &Document, context: &CompletionContext) -> anyhow::Result<MarkupContent> {

    // the markdown string, built from parsing HTML help
    let mut markdown = String::new();

    // get the node
    let node = &context.node;

    // check for identifier
    if !matches!(node.kind(), "identifier" | "keyword") {
        bail!("hover(): ignorning node {}; not an identifier | keyword", node.to_sexp());
    }

    let ctx = hover_context(*node, context)?;
    let ctx = unwrap!(ctx, None => {
        bail!("hover(): no hover context available");
    });

    // get help document
    let mut callback = RFunction::from(".rs.help.getHtmlHelpContents");
    match ctx {

        HoverContext::QualifiedTopic { package, topic } => {
            callback.param("topic", topic);
            callback.param("package", package);
        }

        HoverContext::Topic(topic) => {
            callback.param("topic", topic);
        }

    }

    // if this is a namespace-qualified call, we should add the package explicitly
    let help = callback.call()?.to::<String>()?;

    // parse as html
    let doc = Html::parse_document(help.as_str());

    // get topic + title; normally available in first table in the document
    let selector = Selector::parse("table").unwrap();
    let preamble = doc.select(&selector).next().into_result()?;

    // try to get the first cell
    let selector = Selector::parse("td").unwrap();
    let cell = preamble.select(&selector).next().into_result()?;
    let preamble = elt_text(cell);
    push!(markdown, md_italic(&preamble), md_newline());

    // get title
    let selector = Selector::parse("head > title").unwrap();
    let title = doc.select(&selector).next().into_result()?;
    let mut title = elt_text(title);

    // R prepends 'R: ' to the title, so remove it if that exists
    if title.starts_with("R: ") {
        title.replace_range(0..3, "");
    }

    push!(markdown, md_h2(&title), md_newline(), "------\n");

    // iterate through the different sections in the help file
    elt_foreach(&doc, |header, elements| {

        // add a title
        let header = elt_text(header);
        markdown.push_str(md_h3(header.as_str()).as_str());
        markdown.push_str(md_newline().as_str());

        // add body
        let body = if matches!(header.as_str(), "Usage" | "Examples") {

            let mut buffer = String::new();
            for elt in elements {
                let code = md_codeblock("r", elt_text(elt).as_str());
                buffer.push_str(code.as_str());
            }
            buffer

        } else if matches!(header.as_str(), "Arguments") {

            // create a buffer for table output
            let mut buffer = String::new();

            // add an empty header
            buffer.push_str("|     |     |\n");
            buffer.push_str("| --- | --- |");

            // generate the markdown table
            for elt in elements {
                let converter = MarkdownConverter::new(*elt);
                let table = converter.convert();
                buffer.push_str(table.as_str());
            }

            buffer

        } else {

            let mut buffer = String::new();
            for elt in elements {
                let converter = MarkdownConverter::new(*elt);
                let markdown = converter.convert();
                buffer.push_str(markdown.as_str());
            }

            buffer
        };

        markdown.push_str(body.as_str());
        markdown.push_str(md_newline().as_str());

    });


    Ok(MarkupContent {
        kind: MarkupKind::Markdown,
        value: markdown,
    })

}

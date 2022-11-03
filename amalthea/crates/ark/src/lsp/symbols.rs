//
// symbols.rs
//
// Copyright (C) 2022 by Posit, PBC
//
//

#![allow(deprecated)]

use std::result::Result::Ok;

use anyhow::*;
use log::error;
use stdext::unwrap::IntoResult;
use tower_lsp::lsp_types::DocumentSymbol;
use tower_lsp::lsp_types::DocumentSymbolParams;
use tower_lsp::lsp_types::Location;
use tower_lsp::lsp_types::Range;
use tower_lsp::lsp_types::SymbolInformation;
use tower_lsp::lsp_types::SymbolKind;
use tower_lsp::lsp_types::Url;
use tower_lsp::lsp_types::WorkspaceSymbolParams;
use tree_sitter::Node;

use crate::lsp::backend::Backend;
use crate::lsp::indexer;
use crate::lsp::indexer::IndexEntryData;
use crate::lsp::traits::point::PointExt;

pub fn symbols(backend: &Backend, params: &WorkspaceSymbolParams) -> Result<Vec<SymbolInformation>> {

    let mut info : Vec<SymbolInformation> = Vec::new();

    indexer::map(|path, entry| {

        match &entry.data {

            IndexEntryData::Function { name, arguments } => {

                info.push(SymbolInformation {
                    name: name.to_string(),
                    kind: SymbolKind::FUNCTION,
                    location: Location {
                        uri: Url::from_file_path(path).unwrap(),
                        range: entry.range,
                    },
                    tags: None,
                    deprecated: None,
                    container_name: None,
                });

            },

            IndexEntryData::Section { level, title } => {

                info.push(SymbolInformation {
                    name: title.to_string(),
                    kind: SymbolKind::MODULE,
                    location: Location {
                        uri: Url::from_file_path(path).unwrap(),
                        range: entry.range,
                    },
                    tags: None,
                    deprecated: None,
                    container_name: None,
                });

            },

        };

        Ok(())

    });

    Ok(info)

}

pub fn document_symbols(backend: &Backend, params: &DocumentSymbolParams) -> Result<Vec<DocumentSymbol>> {

    let mut symbols : Vec<DocumentSymbol> = Vec::new();

    let uri = &params.text_document.uri;
    let document = backend.documents.get(uri).into_result()?;
    let ast = document.ast()?;
    let contents = document.contents.to_string();

    let node = ast.root_node();

    // construct a root symbol, so we always have something to append to
    let mut root = DocumentSymbol {
        name: "<root>".to_string(),
        kind: SymbolKind::NULL,
        children: Some(Vec::new()),
        deprecated: None,
        tags: None,
        detail: None,
        range: Range {
            start: node.start_position().as_position(),
            end: node.end_position().as_position(),
        },
        selection_range: Range {
            start: node.start_position().as_position(),
            end: node.end_position().as_position(),
        }
    };

    // index from the root
    index_node(&node, &contents, &mut root, &mut symbols)?;

    // return the children we found
    Ok(root.children.unwrap_or_default())

}

fn index_node(node: &Node, contents: &String, parent: &mut DocumentSymbol, symbols: &mut Vec<DocumentSymbol>) -> Result<bool> {

    // if we find an assignment, index it
    if matches!(node.kind(), "<-" | "=") {
        match index_assignment(node, contents, parent, symbols) {
            Ok(handled) => if handled { return Ok(true) },
            Err(error) => error!("{:?}", error),
        }
    }

    // by default, recurse into children
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        let result = index_node(&child, contents, parent, symbols);
        if let Err(error) = result {
            error!("{:?}", error);
        }
    };

    Ok(true)

}

fn index_assignment(node: &Node, contents: &String, parent: &mut DocumentSymbol, symbols: &mut Vec<DocumentSymbol>) -> Result<bool> {

    // check for assignment
    matches!(node.kind(), "<-" | "=").into_result()?;

    // check for lhs, rhs
    let lhs = node.child_by_field_name("lhs").into_result()?;
    let rhs = node.child_by_field_name("rhs").into_result()?;

    // check for identifier on lhs, function on rhs
    let function =
        matches!(lhs.kind(), "identifier" | "string") &&
        matches!(rhs.kind(), "function");

    if function {
        return index_function(node, contents, parent, symbols);
    }

    // otherwise, just index as generic object
    let name = lhs.utf8_text(contents.as_bytes())?;
    let symbol = DocumentSymbol {
        name: name.to_string(),
        kind: SymbolKind::OBJECT,
        detail: None,
        children: Some(Vec::new()),
        deprecated: None,
        tags: None,
        range: Range {
            start: lhs.start_position().as_position(),
            end: lhs.end_position().as_position(),
        },
        selection_range: Range {
            start: lhs.start_position().as_position(),
            end: lhs.end_position().as_position(),
        }
    };

    // add this symbol to the parent node
    parent.children.as_mut().unwrap().push(symbol);

    Ok(true)

}

fn index_function(node: &Node, contents: &String, parent: &mut DocumentSymbol, symbols: &mut Vec<DocumentSymbol>) -> Result<bool> {

    // check for lhs, rhs
    let lhs = node.child_by_field_name("lhs").into_result()?;
    let rhs = node.child_by_field_name("rhs").into_result()?;

    // start extracting the argument names
    let mut arguments : Vec<String> = Vec::new();
    let parameters = rhs.child_by_field_name("parameters").into_result()?;

    let mut cursor = parameters.walk();
    for parameter in parameters.children_by_field_name("parameter", &mut cursor) {
        let name = parameter.child_by_field_name("name").into_result()?;
        let name = name.utf8_text(contents.as_bytes())?;
        arguments.push(name.to_string());
    }

    let name = lhs.utf8_text(contents.as_bytes())?;
    let detail = format!("function({})", arguments.join(", "));

    // build the document symbol
    let symbol = DocumentSymbol {
        name: name.to_string(),
        kind: SymbolKind::FUNCTION,
        detail: Some(detail),
        children: Some(Vec::new()),
        deprecated: None,
        tags: None,
        range: Range {
            start: lhs.start_position().as_position(),
            end: rhs.end_position().as_position(),
        },
        selection_range: Range {
            start: lhs.start_position().as_position(),
            end: lhs.end_position().as_position(),
        }
    };

    // add this symbol to the parent node
    parent.children.as_mut().unwrap().push(symbol);

    // recurse into this node
    let parent = parent.children.as_mut().unwrap().last_mut().unwrap();
    index_node(&rhs, contents, parent, symbols)?;

    Ok(true)

}

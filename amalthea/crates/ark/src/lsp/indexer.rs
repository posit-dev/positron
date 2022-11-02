//
// indexer.rs
//
// Copyright (C) 2022 by Posit, PBC
//
//

use log::info;
use stdext::*;
use tree_sitter::Node;

use crate::lsp::document::Document;

#[derive(Debug)]
pub(crate) enum IndexedSymbol {

    Function {
        name: String,
        arguments: Vec<String>
    }

}

fn index_node(source: &str, node: &Node, index: &mut Vec<IndexedSymbol>) {

    if index_node_function_definition(source, node, index) {
        return;
    }

}

fn index_node_function_definition(source: &str, node: &Node, index: &mut Vec<IndexedSymbol>) -> bool {

    // Check for assignment.
    if !matches!(node.kind(), "<-" | "=") {
        return false;
    }

    // Check for symbol or string on LHS.
    let lhs = unwrap!(node.child(0), None => {
        return false;
    });

    if !matches!(lhs.kind(), "identifier" | "string") {
        return false;
    }

    // Check for a function definition on RHS.
    let rhs = unwrap!(node.child(2), None => {
        return false;
    });

    if !matches!(rhs.kind(), "function") {
        return false;
    }

    // Start building our indexed symbol.
    let name = lhs.utf8_text(source.as_bytes()).unwrap().to_string();
    let mut arguments : Vec<String> = Vec::new();

    // Get the formal parameters. Because treesitter doesn't parse
    // the parameter list into a tree (it's just a series of tokens)
    // we need to walk those and look for identifiers.
    let params = unwrap!(rhs.child(1), None => {
        return false;
    });

    let mut cursor = params.walk();
    cursor.goto_first_child();

    // Check for opening '('
    if cursor.node().kind() != "(" {
        return false;
    }

    // Move into parameter list
    cursor.goto_next_sibling();

    // Start consuming identifiers
    loop {

        // Bail if we hit a ')'
        if cursor.node().kind() == ")" {
            break;
        }

        // Check for an identifier
        if cursor.node().kind() != "identifier" {
            return false;
        }

        // Add it to the argument list
        arguments.push(cursor.node().utf8_text(source.as_bytes()).unwrap().to_string());

        // Move to the next token
        cursor.goto_next_sibling();

        // Check if we can keep going
        match cursor.node().kind() {

            "," => {
                cursor.goto_next_sibling();
                continue;
            },

            "=" => {
                cursor.goto_next_sibling();
                cursor.goto_next_sibling();
                cursor.goto_next_sibling();
                continue;
            },

            _ => {
                continue;
            }

        }

    }

    index.push(IndexedSymbol::Function { name: name, arguments: arguments });
    return true;

}

pub(crate) fn index_document(document: &Document) -> Vec<IndexedSymbol> {

    let mut index: Vec<IndexedSymbol> = Vec::new();

    let ast = unwrap!(document.ast.as_ref(), None => {
        info!("error unwrapping ast");
        return index;
    });

    let source = document.contents.to_string();

    let root = ast.root_node();
    let mut cursor = root.walk();

    // Move to first child.
    cursor.goto_first_child();
    index_node(&source, &cursor.node(), &mut index);

    // Handle each sibling.
    while cursor.goto_next_sibling() {
        index_node(&source, &cursor.node(), &mut index);
    }

    return index;

}


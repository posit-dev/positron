//
// indexer.rs
//
// Copyright (C) 2022 by Posit, PBC
//
//

// TODO: Properly thread through handling of Results throughout.
// TODO: Provide API for finding definitions in specific (set of) documents.

use std::collections::HashMap;
use std::path::Path;
use std::result::Result::Ok;
use std::sync::Arc;
use std::sync::Mutex;

use anyhow::*;
use lazy_static::lazy_static;
use log::*;
use stdext::unwrap;
use stdext::unwrap::IntoResult;
use tower_lsp::lsp_types::Range;
use tree_sitter::Node;
use walkdir::DirEntry;
use walkdir::WalkDir;

use crate::lsp::document::Document;
use crate::lsp::traits::point::PointExt;

#[derive(Clone, Debug)]
pub enum IndexEntryData {
    Function { name: String, arguments: Vec<String> },
    Symbol { name: String },
}

#[derive(Clone, Debug)]
pub struct IndexEntry {
    pub range: Range,
    pub data: IndexEntryData,
}

type DocumentPath = String;
type DocumentSymbol = String;
type DocumentIndex = HashMap<DocumentSymbol, IndexEntry>;
type WorkspaceIndex = Arc<Mutex<HashMap<DocumentPath, DocumentIndex>>>;

lazy_static! {
    static ref WORKSPACE_INDEX : WorkspaceIndex = Default::default();
}

pub fn start(folders: Vec<String>) {

    // create a task that indexes these folders
    info!("Spawning indexer.");
    let _handle = tokio::spawn(async move {
        for folder in folders {
            let walker = WalkDir::new(folder);
            for entry in walker.into_iter().filter_map(|e| filter_entry(e)) {
                if entry.file_type().is_file() {
                    index_file(entry.path());
                }
            }
        }
    });

}

pub fn find(symbol: &str) -> Option<(String, IndexEntry)> {

    // get index lock
    let index = unwrap!(WORKSPACE_INDEX.lock(), Err(error) => {
        error!("{:?}", error);
        return None;
    });

    // start iterating through index entries
    for (path, index) in index.iter() {
        if let Some(entry) = index.get(symbol) {
            return Some((path.clone(), entry.clone()));
        }
    }

    None

}

pub fn map(mut callback: impl FnMut(&String, &IndexEntry) -> anyhow::Result<()>) {

    let index = unwrap!(WORKSPACE_INDEX.lock(), Err(error) => {
        error!("{:?}", error);
        return;
    });

    for (path, index) in index.iter() {
        for (symbol, entry) in index.iter() {
            callback(path, entry);
        }
    }

}

fn insert(path: &Path, symbol: &str, entry: IndexEntry) {

    let mut index = unwrap!(WORKSPACE_INDEX.lock(), Err(error) => {
        error!("{:?}", error);
        return;
    });

    let path = unwrap!(path.to_str(), None => {
        error!("Couldn't convert path {} to string", path.display());
        return;
    });

    let index = index.entry(path.to_string()).or_default();
    index.insert(symbol.to_string(), entry);

}

fn filter_entry(entry: walkdir::Result<DirEntry>) -> Option<DirEntry> {

    let entry = entry.ok()?;

    let name = entry.file_name().to_str()?;
    if matches!(name, ".git" | "node_modules") {
        return None;
    }

    Some(entry)

}

fn index_file(path: &Path) -> Option<bool> {

    // only index R files
    let ext = path.extension()?.to_str()?;
    if !matches!(ext, "r" | "R") {
        return None;
    }

    // TODO: Handle document encodings here.
    // TODO: Check if there's an up-to-date buffer to be used.
    let contents = std::fs::read(path).ok()?;
    let contents = String::from_utf8(contents).ok()?;
    let document = Document::new(contents.as_str());

    info!("Indexing document at path {}", path.display());
    index_document(&document, path);

    Some(true)
}

fn index_document(document: &Document, path: &Path) -> Result<()> {

    let ast = document.ast()?;
    let source = document.contents.to_string();

    let root = ast.root_node();
    let mut cursor = root.walk();

    // Move to first child.
    cursor.goto_first_child();
    index_node(path, &source, &cursor.node());

    // Handle each sibling.
    while cursor.goto_next_sibling() {
        index_node(path, &source, &cursor.node());
    }

    Ok(())

}

fn index_node(path: &Path, source: &str, node: &Node) -> Result<()> {

    if let Err(_) = index_node_function_definition(path, source, node) {
        // TODO: Figure out when we should log errors.
    }

    Ok(())

}

fn index_node_function_definition(path: &Path, source: &str, node: &Node) -> Result<()> {

    // Check for assignment.
    matches!(node.kind(), "<-" | "=").into_result()?;

    // Check for identifier on left-hand side.
    let lhs = node.child_by_field_name("lhs").into_result()?;
    matches!(lhs.kind(), "identifier" | "string").into_result()?;

    // Check for a function definition on the right-hand side.
    let rhs = node.child_by_field_name("rhs").into_result()?;
    matches!(rhs.kind(), "function").into_result()?;

    let name = lhs.utf8_text(source.as_bytes())?;
    let mut arguments = Vec::new();

    // Get the parameters node.
    let parameters = rhs.child_by_field_name("parameters").into_result()?;

    // Iterate through each, and get the names.
    let mut cursor = parameters.walk();
    for child in parameters.children(&mut cursor) {
        let name = unwrap!(child.child_by_field_name("name"), None => continue);
        if matches!(name.kind(), "identifier") {
            let name = name.utf8_text(source.as_bytes())?;
            arguments.push(name.to_string());
        }
    }

    // Create the index entry.
    let entry = IndexEntry {
        range: Range {
            start: lhs.start_position().as_position(),
            end: lhs.end_position().as_position(),
        },
        data: IndexEntryData::Function {
            name: name.to_string(),
            arguments: arguments,
        }
    };

    insert(path, name, entry);
    Ok(())

}

//
// document.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

use std::sync::Arc;

use anyhow::*;
use dashmap::DashMap;
use lazy_static::lazy_static;
use ropey::Rope;
use tower_lsp::lsp_types::DidChangeTextDocumentParams;
use tower_lsp::lsp_types::TextDocumentContentChangeEvent;
use tower_lsp::lsp_types::Url;
use tree_sitter::InputEdit;
use tree_sitter::Parser;
use tree_sitter::Point;
use tree_sitter::Tree;

use crate::lsp::traits::position::PositionExt;
use crate::lsp::traits::rope::RopeExt;

lazy_static! {

    // The document index. Stored as a global since various components need to
    // access the document index, and we want to do so without needing to share
    // too many pieces everywhere.
    //
    // Note that DashMap uses synchronization primitives internally, so we
    // don't guard access to the map via a mutex.
    pub static ref DOCUMENT_INDEX: Arc<DashMap<Url, Document>> = Default::default();

}

fn compute_point(
    point: Point,
    text: &str,
) -> Point {
    // figure out where the newlines in this edit are
    let newline_indices: Vec<_> = text.match_indices('\n').collect();
    let num_newlines = newline_indices.len();
    let num_bytes = text.as_bytes().len();

    if newline_indices.len() == 0 {
        return Point::new(point.row, point.column + num_bytes);
    } else {
        let last_newline_index = newline_indices.last().unwrap();
        return Point::new(
            point.row + num_newlines,
            num_bytes - last_newline_index.0 - 1,
        );
    }
}

pub struct Document {
    // The document's textual contents.
    pub contents: Rope,

    // A set of pending changes for this document.
    pub pending: Vec<DidChangeTextDocumentParams>,

    // The version of the document we last synchronized with.
    // None if the document hasn't been synchronized yet.
    pub version: Option<i32>,

    // The parser used to generate the AST.
    pub parser: Parser,

    // The document's AST.
    pub ast: Tree,
}

impl std::fmt::Debug for Document {
    fn fmt(
        &self,
        f: &mut std::fmt::Formatter<'_>,
    ) -> std::fmt::Result {
        f.debug_struct("Document")
            .field("contents", &self.contents)
            .field("ast", &self.ast)
            .finish()
    }
}

impl Document {
    pub fn new(contents: &str) -> Self {
        // create initial document from rope
        let document = Rope::from(contents);

        // create a parser for this document
        let mut parser = Parser::new();
        parser
            .set_language(tree_sitter_r::language())
            .expect("failed to create parser");
        let ast = parser.parse(contents, None).unwrap();

        let pending = Vec::new();
        let version = None;

        // return generated document
        Self {
            contents: document,
            pending,
            version,
            parser,
            ast,
        }
    }

    pub fn on_did_change(
        &mut self,
        params: &DidChangeTextDocumentParams,
    ) -> Result<i32> {
        // Add pending changes.
        self.pending.push(params.clone());

        // Check the version of this update.
        //
        // If we receive version {n + 2} before {n + 1}, then we'll
        // bail here, and handle the {n + 2} change after we received
        // version {n + 1}.
        //
        // TODO: What if an intermediate document change is somehow dropped or lost?
        // Do we need a way to recover (e.g. reset the document state)?
        if let Some(old_version) = self.version {
            let new_version = params.text_document.version;
            if new_version > old_version + 1 {
                log::info!("on_did_change(): received out-of-order document changes; deferring");
                return Ok(old_version);
            }
        }

        // Get pending updates, sort by version, and then apply them one-by-one.
        self.pending.sort_by(|lhs, rhs| {
            let lhs = lhs.text_document.version;
            let rhs = rhs.text_document.version;
            lhs.cmp(&rhs)
        });

        // Get the maximum version.
        let version = self.pending.last().unwrap().text_document.version;

        // Take the changes, and apply them one-by-one.
        let changes = std::mem::take(&mut self.pending);
        for change in changes {
            for event in change.content_changes {
                if let Err(error) = self.update(&event) {
                    log::error!("error updating document: {}", error);
                }
            }
        }

        // Updates successfully applied; update cached document version.
        self.version = Some(version);

        Ok(version)
    }

    fn update(
        &mut self,
        change: &TextDocumentContentChangeEvent,
    ) -> Result<()> {
        // Extract edit range. Nothing to do if there wasn't an edit.
        let range = match change.range {
            Some(r) => r,
            None => return Ok(()),
        };

        // Update the AST. We do this before updating the underlying document
        // contents, because edit computations need to be done using the current
        // state of the document (prior to the edit being applied) so that byte
        // offsets can be computed correctly.
        let ast = &mut self.ast;

        let start_byte = self.contents.position_to_byte(range.start);
        let start_position = range.start.as_point();

        let old_end_byte = self.contents.position_to_byte(range.end);
        let new_end_byte = start_byte + change.text.as_bytes().len();

        let old_end_position = range.end.as_point();
        let new_end_position = compute_point(start_position, &change.text);

        let edit = InputEdit {
            start_byte,
            old_end_byte,
            new_end_byte,
            start_position,
            old_end_position,
            new_end_position,
        };

        ast.edit(&edit);

        // Now, apply edits to the underlying document.
        let lhs = self.contents.position_to_byte(range.start);
        let rhs = self.contents.position_to_byte(range.end);

        // Now, convert from byte offsets to character offsets.
        let lhs = self.contents.byte_to_char(lhs);
        let rhs = self.contents.byte_to_char(rhs);

        // Remove the old slice of text, and insert the new slice of text.
        self.contents.remove(lhs..rhs);
        self.contents.insert(lhs, change.text.as_str());

        // We've edited the AST, and updated the document. We can now re-parse.
        let contents = self.contents.to_string();
        let ast = self.parser.parse(&contents, Some(&self.ast));
        self.ast = ast.unwrap();

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_point_computation() {
        // empty strings shouldn't do anything
        let point = compute_point(Point::new(0, 0), "");
        assert_eq!(point, Point::new(0, 0));

        let point = compute_point(Point::new(42, 42), "");
        assert_eq!(point, Point::new(42, 42));

        // text insertion without newlines should just extend the column position
        let point = compute_point(Point::new(0, 0), "abcdef");
        assert_eq!(point, Point::new(0, 6));

        // text insertion with newlines should change the row
        let point = compute_point(Point::new(0, 0), "abc\ndef\nghi");
        assert_eq!(point, Point::new(2, 3));

        let point = compute_point(Point::new(0, 0), "abcdefghi\n");
        assert_eq!(point, Point::new(1, 0));
    }
}

//
// definitions.rs
//
// Copyright (C) 2022 by Posit, PBC
//
//

use anyhow::Result;
use tower_lsp::lsp_types::GotoDefinitionParams;
use tower_lsp::lsp_types::Range;
use tree_sitter::Node;

use crate::lsp::document::Document;
use crate::lsp::traits::point::PointExt;
use crate::lsp::traits::position::PositionExt;
use crate::lsp::traits::tree::TreeExt;

pub struct GotoDefinitionContext<'a> {
    pub document: &'a Document,
    pub node: Node<'a>,
    pub range: Range,
    pub params: GotoDefinitionParams,
}

pub fn goto_definition_context<'a>(document: &'a Document, params: GotoDefinitionParams) -> Result<GotoDefinitionContext<'a>> {

    // get reference to AST
    let ast = &document.ast;

    // try to find node at completion position
    let point = params.text_document_position_params.position.as_point();
    let node = ast.node_at_point(point)?;
    let range = Range {
        start: node.start_position().as_position(),
        end: node.end_position().as_position(),
    };

    // build completion context
    Ok(GotoDefinitionContext { document, node, range, params })

}

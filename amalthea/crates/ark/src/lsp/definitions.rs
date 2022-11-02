//
// definitions.rs
//
// Copyright (C) 2022 by Posit, PBC
//
//

use anyhow::Result;
use stdext::unwrap::IntoResult;
use tower_lsp::lsp_types::GotoDefinitionParams;
use tower_lsp::lsp_types::Range;

use crate::lsp::document::Document;
use crate::lsp::traits::point::PointExt;
use crate::lsp::traits::position::PositionExt;

pub struct GotoDefinitionContext<'a> {
    pub document: &'a mut Document,
    pub range: Range,
    pub params: GotoDefinitionParams,
}

pub fn goto_definition_context<'a>(document: &'a mut Document, params: GotoDefinitionParams) -> Result<GotoDefinitionContext<'a>> {

    // get reference to AST
    let ast = document.ast()?;

    // try to find node at completion position
    let point = params.text_document_position_params.position.as_point();
    let node = ast.root_node().descendant_for_point_range(point, point).into_result()?;
    let range = Range {
        start: node.start_position().as_position(),
        end: node.end_position().as_position(),
    };

    // build completion context
    Ok(GotoDefinitionContext { document, range, params })

}

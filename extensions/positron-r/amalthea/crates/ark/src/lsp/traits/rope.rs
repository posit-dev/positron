//
// rope.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

use ropey::Rope;
use tower_lsp::lsp_types::Position;
use tree_sitter::Point;

pub trait RopeExt {
    fn point_to_byte(&self, point: Point) -> usize;
    fn position_to_byte(&self, position: Position) -> usize;
}

impl RopeExt for Rope {

    // TODO: We likely need to translate column positions into byte positions,
    // to properly handle multibyte unicode characters.
    fn point_to_byte(&self, point: Point) -> usize {
        self.line_to_byte(point.row) + point.column
    }

    fn position_to_byte(&self, position: Position) -> usize {
        self.line_to_byte(position.line as usize) + position.character as usize
    }

}

// 
// position.rs
// 
// Copyright (C) 2022 by Posit Software, PBC
// 
// 

use tower_lsp::lsp_types::Position;
use tree_sitter::Point;

pub trait PositionExt {
    fn as_point(&self) -> Point;
}

impl PositionExt for Position {

    fn as_point(&self) -> Point {
        Point { row: self.line as usize, column: self.character as usize }
    }
}

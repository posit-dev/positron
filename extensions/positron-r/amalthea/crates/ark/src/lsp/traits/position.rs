//
// position.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
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

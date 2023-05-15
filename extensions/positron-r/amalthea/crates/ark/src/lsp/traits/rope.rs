//
// rope.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

use ropey::Rope;
use tower_lsp::lsp_types::Position;

pub trait RopeExt {
    fn position_to_byte(
        &self,
        position: Position,
    ) -> usize;
}

impl RopeExt for Rope {
    fn position_to_byte(
        &self,
        position: Position,
    ) -> usize {
        self.line_to_byte(position.line as usize) + position.character as usize
    }
}

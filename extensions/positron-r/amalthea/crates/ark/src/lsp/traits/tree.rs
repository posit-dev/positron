//
// tree.rs
//
// Copyright (C) 2022 by Posit Software, PBC
//
//

use anyhow::*;
use tree_sitter::Node;
use tree_sitter::Point;
use tree_sitter::Tree;

pub trait TreeExt {
    fn node_at_point(&self, point: Point) -> Result<Node>;
}

impl TreeExt for Tree {
    fn node_at_point(&self, point: Point) -> Result<Node> {
        self
            .root_node()
            .descendant_for_point_range(point, point)
            .context(format!("internal error: no node at point {:?}", point))
    }
}

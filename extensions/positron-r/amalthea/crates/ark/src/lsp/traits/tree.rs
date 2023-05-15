//
// tree.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

use tree_sitter::Node;
use tree_sitter::Point;
use tree_sitter::Tree;

use crate::lsp::traits::node::NodeExt;

pub trait TreeExt {
    fn node_at_point(&self, point: Point) -> Node;
}

impl TreeExt for Tree {

    fn node_at_point(&self, point: Point) -> Node {

        let mut node = self.root_node();

        // First, recurse through children to find the smallest
        // node that contains the requested point.
        'outer: loop {

            let mut cursor = node.walk();
            let children = node.children(&mut cursor);
            for child in children {
                if child.contains_point(point) {
                    node = child;
                    continue 'outer;
                }
            }

            break;

        }

        // Next, iterate through the children of this node
        // (if any) to find the closest child.
        let mut cursor = node.walk();
        let children = node.children(&mut cursor);
        for child in children {
            if child.start_position() <= point {
                node = child;
            }
        }

        // Return the discovered node.
        node

    }
}

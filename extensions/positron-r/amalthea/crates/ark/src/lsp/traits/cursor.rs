//
// cursor.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

use tree_sitter::{Node, Point, TreeCursor};

use crate::lsp::traits::point::PointExt;
use crate::lsp::traits::range::RangeExt;

fn _recurse_impl<Callback: FnMut(Node) -> bool>(this: &mut TreeCursor, callback: &mut Callback) {

    if !callback(this.node()) {
        return;
    }

    if this.goto_first_child() {

        _recurse_impl(this, callback);
        while this.goto_next_sibling() {
            _recurse_impl(this, callback);
        }
        this.goto_parent();

    }

}

fn _find_impl<Callback: FnMut(Node) -> bool>(this: &mut TreeCursor, callback: &mut Callback) -> bool {

    if !callback(this.node()) {
        return false;
    }

    if this.goto_first_child() {

        if !_find_impl(this, callback) {
            return false;
        }

        while this.goto_next_sibling() {

            if !_find_impl(this, callback) {
                return false;
            }

        }

        this.goto_parent();

    }

    return true;

}

fn _find_leaf_impl(mut node: Node, point: Point) -> Node {

    let mut cursor = node.walk();

    for child in node.children(&mut cursor) {
        if child.range().contains_point(point) {
            return _find_leaf_impl(child, point);
        }
    }

    for child in node.children(&mut cursor) {
        if child.start_position().is_before_or_equal(point) {
            node = child;
        }
    }

    node

}

// Extension trait for the TreeSitter cursor object.
pub trait TreeCursorExt {

    // Recurse through all nodes in an AST, invoking a callback as those nodes
    // are visited. The callback can return `false` to indicate that we shouldn't
    // recurse through the children of a particular node.
    fn recurse<Callback: FnMut(Node) -> bool>(&mut self, callback: Callback);

    // Find a node in an AST. The first node for which the callback returns 'true'
    // will be returned.
    fn find<Callback: FnMut(Node) -> bool>(&mut self, callback: Callback) -> bool;

    // Move the cursor to the parent node satisfying some callback condition.
    fn find_parent<Callback: FnMut(Node) -> bool>(&mut self, callback: Callback) -> bool;

    // Find a leaf node in the AST. The leaf node either at the requested point,
    // or the leaf node closest (but not after) the requested point, will be returned.
    fn find_leaf(&mut self, point: Point) -> Node;

}

impl TreeCursorExt for TreeCursor<'_> {

    fn recurse<Callback: FnMut(Node) -> bool>(&mut self, mut callback: Callback) {
        _recurse_impl(self, &mut callback)
    }

    fn find<Callback: FnMut(Node) -> bool>(&mut self, mut callback: Callback) -> bool {
        _find_impl(self, &mut callback)
    }

    fn find_parent<Callback: FnMut(Node) -> bool>(&mut self, mut callback: Callback) -> bool {

        while self.goto_parent() {
            if callback(self.node()) {
                return true;
            }
        }

        return false;

    }

    fn find_leaf(&mut self, point: Point) -> Node {
        let node = self.node();
        _find_leaf_impl(node, point)
    }

}

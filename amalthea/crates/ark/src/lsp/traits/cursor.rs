// 
// cursor.rs
// 
// Copyright (C) 2022 by Posit, PBC
// 
// 

use tree_sitter::{Node, Point, TreeCursor};

use crate::lsp::traits::point::PointExt;

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

// Extension trait for the TreeSitter cursor object.
pub trait TreeCursorExt {

    // Recurse through all nodes in an AST, invoking a callback as those nodes
    // are visited. The callback can return `false` to indicate that we shouldn't
    // recurse through the children of a particular node.
    fn recurse<Callback: FnMut(Node) -> bool>(&mut self, callback: Callback);

    // Find a node in an AST. The first node for which the callback returns 'true'
    // will be returned.
    fn find<Callback: FnMut(Node) -> bool>(&mut self, callback: Callback) -> bool;

    // Find the node closest to the requested point (if any). The node closest
    // to this point will be used.
    fn goto_point(&mut self, point: Point);

    // Move the cursor to the parent node satisfying some callback condition.
    fn find_parent<Callback: FnMut(Node) -> bool>(&mut self, callback: Callback) -> bool;
    
}

impl TreeCursorExt for TreeCursor<'_> {

    fn recurse<Callback: FnMut(Node) -> bool>(&mut self, mut callback: Callback) {
        _recurse_impl(self, &mut callback)
    }

    fn find<Callback: FnMut(Node) -> bool>(&mut self, mut callback: Callback) -> bool {
        _find_impl(self, &mut callback)
    }

    fn goto_point(&mut self, point: Point) {

        // TODO: logic here is not quite right
        self.recurse(|node| {
            if node.start_position().is_before_or_equal(point) {
                return true;
            } else {
                return false;
            }
        });

    }

    fn find_parent<Callback: FnMut(Node) -> bool>(&mut self, mut callback: Callback) -> bool {

        while self.goto_parent() {
            if callback(self.node()) {
                return true;
            }
        }

        return false;

    }


}

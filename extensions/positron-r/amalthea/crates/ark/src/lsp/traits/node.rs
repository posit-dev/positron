// node.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

use stdext::all;
use tree_sitter::Node;
use tree_sitter::Point;
use tree_sitter::TreeCursor;

fn _dump_impl(cursor: &mut TreeCursor, source: &str, indent: &str, output: &mut String) {
    let node = cursor.node();

    if node.start_position().row == node.end_position().row {
        // write line
        output.push_str(
            format!(
                "{} - {} - {} ({} -- {})\n",
                indent.to_string(),
                node.utf8_text(source.as_bytes()).unwrap(),
                node.kind().to_string(),
                node.start_position().to_string(),
                node.end_position().to_string(),
            )
            .as_str(),
        );
    }

    if cursor.goto_first_child() {
        let indent = format!("  {}", indent);
        _dump_impl(cursor, source, indent.as_str(), output);
        while cursor.goto_next_sibling() {
            _dump_impl(cursor, source, indent.as_str(), output);
        }

        cursor.goto_parent();
    }
}

pub struct FwdLeafIterator<'a> {
    pub node: Node<'a>,
}

impl<'a> Iterator for FwdLeafIterator<'a> {
    type Item = Node<'a>;

    fn next(&mut self) -> Option<Self::Item> {
        if let Some(node) = self.node.next_leaf() {
            self.node = node;
            Some(node)
        } else {
            None
        }
    }
}

pub struct BwdLeafIterator<'a> {
    pub node: Node<'a>,
}

impl<'a> Iterator for BwdLeafIterator<'a> {
    type Item = Node<'a>;

    fn next(&mut self) -> Option<Self::Item> {
        if let Some(node) = self.node.prev_leaf() {
            self.node = node;
            Some(node)
        } else {
            None
        }
    }
}

pub trait NodeExt: Sized {
    fn dump(&self, source: &str) -> String;

    fn find_parent(&self, callback: impl Fn(&Self) -> bool) -> Option<Self>;

    fn contains_point(&self, point: Point) -> bool;

    fn prev_leaf(&self) -> Option<Self>;
    fn next_leaf(&self) -> Option<Self>;

    fn fwd_leaf_iter(&self) -> FwdLeafIterator<'_>;
    fn bwd_leaf_iter(&self) -> BwdLeafIterator<'_>;

    fn is_call(&self) -> bool;
    fn is_unary_operator(&self) -> bool;
    fn is_binary_operator(&self) -> bool;
}

impl NodeExt for Node<'_> {
    fn dump(&self, source: &str) -> String {
        let mut output = "\n".to_string();
        _dump_impl(&mut self.walk(), source, "", &mut output);
        return output;
    }

    fn find_parent(&self, callback: impl Fn(&Self) -> bool) -> Option<Self> {
        let mut node = *self;
        loop {
            if callback(&node) {
                return Some(node);
            }

            node = match node.parent() {
                Some(node) => node,
                None => return None,
            }
        }
    }

    fn contains_point(&self, point: Point) -> bool {
        self.start_position() <= point && self.end_position() >= point
    }

    fn prev_leaf(&self) -> Option<Self> {
        // Walk up the tree, until we find a node with a previous sibling.
        // Then, move to that sibling.
        // Finally, descend down the last children of that node, if any.
        //
        //    x _ _ < _ _ x
        //    |           |
        //    v           ^
        //    |           |
        //    x           x
        //
        let mut node = self.clone();
        while node.prev_sibling().is_none() {
            node = match node.parent() {
                Some(parent) => parent,
                None => return None,
            }
        }

        node = node.prev_sibling().unwrap();

        loop {
            let count = node.child_count();
            if count == 0 {
                break;
            }

            node = node.child(count - 1).unwrap();
            continue;
        }

        Some(node)
    }

    fn next_leaf(&self) -> Option<Self> {
        // Walk up the tree, until we find a node with a sibling.
        // Then, move to that sibling.
        // Finally, descend down the first children of that node, if any.
        //
        //    x _ _ > _ _ x
        //    |           |
        //    ^           v
        //    |           |
        //    x           x
        //
        let mut node = self.clone();
        while node.next_sibling().is_none() {
            node = match node.parent() {
                Some(parent) => parent,
                None => return None,
            }
        }

        node = node.next_sibling().unwrap();

        loop {
            if let Some(child) = node.child(0) {
                node = child;
                continue;
            }
            break;
        }

        Some(node)
    }

    fn fwd_leaf_iter(&self) -> FwdLeafIterator<'_> {
        FwdLeafIterator { node: self.clone() }
    }

    fn bwd_leaf_iter(&self) -> BwdLeafIterator<'_> {
        BwdLeafIterator { node: self.clone() }
    }

    fn is_call(&self) -> bool {
        matches!(self.kind(), "call")
    }

    fn is_unary_operator(&self) -> bool {
        all! {
            self.child_by_field_name("operand").is_some()
        }
    }

    fn is_binary_operator(&self) -> bool {
        all! {
            self.child_by_field_name("operand").is_none()
            self.child_by_field_name("operator").is_some()
        }
    }
}

//
// node.rs
//
// Copyright (C) 2022 by Posit, PBC
//
//

use stdext::all;
use tree_sitter::{Node, TreeCursor};

fn _dump_impl(cursor: &mut TreeCursor, source: &str, indent: &str, output: &mut String) {

    let node = cursor.node();

    if node.start_position().row == node.end_position().row {

        // write line
        output.push_str(format!(
            "{} - {} - {} ({} -- {})\n",
            indent.to_string(),
            node.utf8_text(source.as_bytes()).unwrap(),
            node.kind().to_string(),
            node.start_position().to_string(),
            node.end_position().to_string(),
        ).as_str());

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

pub trait NodeExt {
    fn dump(&self, source: &str) -> String;

    fn find_parent(&self, callback: impl Fn(&Node) -> bool) -> Option<Node>;

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

    fn find_parent(&self, callback: impl Fn(&Node) -> bool) -> Option<Node> {

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

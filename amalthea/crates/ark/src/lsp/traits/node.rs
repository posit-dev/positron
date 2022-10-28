//
// node.rs
//
// Copyright (C) 2022 by RStudio, PBC
//
//

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
}

impl NodeExt for Node<'_> {
    fn dump(&self, source: &str) -> String {
        let mut output = "\n".to_string();
        _dump_impl(&mut self.walk(), source, "", &mut output);
        return output;
    }
}

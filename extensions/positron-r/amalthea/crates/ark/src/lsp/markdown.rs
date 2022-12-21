//
// markdown.rs
//
// Copyright (C) 2022 by Posit Software, PBC
//
//

#![allow(dead_code)]

use ego_tree::NodeRef;
use scraper::ElementRef;
use scraper::Node;
use scraper::node::Text;
use stdext::join;

pub fn md_codeblock(language: &str, code: &str) -> String {
    join!("``` ", language, "\n", code, "\n", "```", "\n")
}

pub fn md_bold(text: &str) -> String {
    join!("**", text, "**")
}

pub fn md_italic(text: &str) -> String {
    join!("_", text, "_")
}

pub fn md_h1(text: &str) -> String {
    join!("# ", text)
}

pub fn md_h2(text: &str) -> String {
    join!("## ", text)
}

pub fn md_h3(text: &str) -> String {
    join!("### ", text)
}

pub fn md_h4(text: &str) -> String {
    join!("#### ", text)
}

pub fn md_h5(text: &str) -> String {
    join!("###### ", text)
}

pub fn md_h6(text: &str) -> String {
    join!("###### ", text)
}

pub fn md_newline() -> String {
    "\n\n".to_string()
}

pub fn elt_text(node: ElementRef) -> String {
    node.text().collect::<String>()
}

pub fn elt_prev(node: ElementRef) -> Option<ElementRef> {

    for sibling in node.prev_siblings() {
        if let Some(elt) = ElementRef::wrap(sibling) {
            return Some(elt)
        }
    }

    None

}

pub fn elt_next(node: ElementRef) -> Option<ElementRef> {

    for sibling in node.next_siblings() {
        if let Some(elt) = ElementRef::wrap(sibling) {
            return Some(elt)
        }
    }

    None

}


pub struct MarkdownConverter<'a> {
    node: NodeRef<'a, Node>,
}

impl<'a> MarkdownConverter<'a> {

    pub fn new(node: NodeRef<'a, Node>) -> Self {
        MarkdownConverter { node }
    }

    pub fn convert(&self) -> String {
        let mut buffer = String::new();
        self.convert_node(self.node, &mut buffer);
        buffer
    }

    fn convert_node(&self, node: NodeRef<'a, Node>, buffer: &mut String) {
        if node.value().is_element() {
            let element = ElementRef::wrap(node).unwrap();
            self.convert_element(element, buffer);
        } else if node.value().is_text() {
            let text = node.value().as_text().unwrap();
            self.convert_text(text, buffer);
        }
    }

    fn convert_element(&self, element: ElementRef<'a>, buffer: &mut String) {

        let name = element.value().name();
        match name {

            "code" => {
                buffer.push('`');
                self.convert_children(element, buffer);
                buffer.push('`');
            }

            "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
                let count = name.chars().nth(1).unwrap_or('0').to_digit(10).unwrap_or(0);
                buffer.push_str("#".repeat(count as usize).as_str());
                buffer.push(' ');
                self.convert_children(element, buffer);
            }

            "tr" => {
                self.convert_row(element, buffer, |cell, buffer| {
                    self.convert_node(*cell, buffer);
                })
            }

            "ol" => {
                for child in element.children() {
                    if child.value().is_element() {
                        let child = ElementRef::wrap(child).unwrap();
                        buffer.push_str("1. ");
                        self.convert_element(child, buffer);
                    }
                }
            }

            "ul" => {
                for child in element.children() {
                    if child.value().is_element() {
                        let child = ElementRef::wrap(child).unwrap();
                        buffer.push_str("- ");
                        self.convert_element(child, buffer);
                    }
                }
            }

            _ => {
                self.convert_children(element, buffer);
            }

        }

    }

    fn convert_children(&self, node: ElementRef<'a>, buffer: &mut String) {
        for child in node.children() {
            self.convert_node(child, buffer)
        }
    }

    fn convert_text(&self, text: &Text, buffer: &mut String) {
        buffer.push_str(text.to_string().as_str())
    }

    fn convert_tr(&self, element: ElementRef<'a>, buffer: &mut String) {

        self.convert_row(element, buffer, |cell, buffer| {
            self.convert_node(*cell, buffer);
        })
    }

    fn convert_row(&self, element: ElementRef<'a>, buffer: &mut String, mut callback: impl FnMut(ElementRef<'a>, &mut String)) {

        buffer.push_str("| ");
        for child in element.children() {
            if child.value().is_element() {
                let child = ElementRef::wrap(child).unwrap();
                let mut contents = String::new();
                callback(child, &mut contents);
                contents = contents.replace("\n", " ");
                buffer.push_str(contents.as_str().trim());
                buffer.push_str(" | ");
            }
        }
        buffer.pop();

    }

}

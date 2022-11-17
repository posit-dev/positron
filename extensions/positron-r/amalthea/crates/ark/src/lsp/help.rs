//
// help.rs
//
// Copyright (C) 2022 by Posit, PBC
//
//

use anyhow::*;
use harp::exec::RFunction;
use harp::exec::RFunctionExt;
use harp::utils::r_typeof;
use libR_sys::*;
use regex::Regex;
use scraper::ElementRef;
use scraper::Html;
use scraper::Selector;
use stdext::push;
use stdext::unwrap;
use stdext::unwrap::IntoResult;
use tower_lsp::lsp_types::MarkupContent;
use tower_lsp::lsp_types::MarkupKind;

use crate::lsp::markdown::*;

pub struct RHtmlHelp {
    html: Html,
}

pub enum Status {
    Done,
    KeepGoing,
}

impl RHtmlHelp {

    pub unsafe fn new(topic: &str, package: Option<&str>) -> Result<Option<Self>> {

        // trim off a package prefix if necessary
        let package = package.map(|s| s.replace("package:", ""));

        // get help document
        let contents = RFunction::from(".rs.help.getHtmlHelpContents")
            .param("topic", topic)
            .param("package", package)
            .call()?;

        // check for NULL (implies no help available)
        if r_typeof(*contents) == NILSXP {
            return Ok(None);
        }

        // parse as html
        let contents = contents.to::<String>()?;
        let html = Html::parse_document(contents.as_str());
        Ok(Some(Self { html }))

    }

    pub fn topic(&self) -> Option<String> {

        // get topic + title; normally available in first table in the document
        let selector = Selector::parse("table").unwrap();
        let preamble = self.html.select(&selector).next()?;

        // try to get the first cell
        let selector = Selector::parse("td").unwrap();
        let cell = preamble.select(&selector).next()?;
        let preamble = elt_text(cell);

        Some(preamble)

    }

    pub fn title(&self) -> Option<String> {

        let selector = Selector::parse("head > title").unwrap();
        let title = self.html.select(&selector).next()?;
        let mut title = elt_text(title);

        // R prepends 'R: ' to the title, so remove it if that exists
        if title.starts_with("R: ") {
            title.replace_range(0..3, "");
        }

        Some(title)

    }

    #[allow(unused)]
    pub fn section(&self, name: &str) -> Option<Vec<ElementRef>> {

        // find all h3 headers in the document
        let selector = Selector::parse("h3").unwrap();
        let mut headers = self.html.select(&selector);

        // search for the header with the matching name
        let needle = format!("<h2>{}</h2>", name);
        let header = headers.find(|elt| {
            elt.inner_html() == needle
        });

        let header = match header {
            Some(header) => header,
            None => return None,
        };

        // start collecting elements
        let mut elements : Vec<ElementRef> = Vec::new();
        let mut elt = header;

        loop {

            elt = match elt_next(elt) {
                Some(elt) => elt,
                None => break,
            };

            if matches!(elt.value().name(), "h1" | "h2" | "h3") {
                break;
            }

            elements.push(elt);

        }

        Some(elements)

    }

    pub fn parameters(&self, mut callback: impl FnMut(&Vec<&str>, &ElementRef) -> Status) -> Result<()> {

        // Find and parse the arguments in the HTML help. The help file has the structure:
        //
        // <h3>Arguments</h3>
        //
        // <table>
        // <tr style="vertical-align: top;"><td><code>parameter</code></td>
        // <td>
        // Parameter documentation.
        // </td></tr>
        //
        // Note that parameters might be parsed as part of different, multiple tables;
        // we need to iterate over all tables after the Arguments header.
        let selector = Selector::parse("h3").unwrap();
        let mut headers = self.html.select(&selector);
        let header = headers.find(|node| node.html() == "<h3>Arguments</h3>").into_result()?;

        let mut elt = header;
        loop {

            // Get the next element.
            elt = unwrap!(elt_next(elt), None => break);

            // If it's a header, time to stop parsing.
            if elt.value().name() == "h3" {
                break;
            }

            // If it's not a table, skip it.
            if elt.value().name() != "table" {
                continue;
            }

            // Get the cells in this table.
            // I really wish R included classes on these table elements...
            let selector = Selector::parse(r#"tr[style="vertical-align: top;"] > td"#).unwrap();
            let mut cells = elt.select(&selector);

            // Start iterating through pairs of cells.
            loop {

                // Get the parameters. Note that multiple parameters might be contained
                // within a single table cell, so we'll need to split that later.
                let lhs = unwrap!(cells.next(), None => { break });
                let names : String = lhs.text().collect();

                // Get the parameters associated with this description.
                let pattern = Regex::new("\\s*,\\s*").unwrap();
                let names = pattern.split(names.as_str()).collect::<Vec<_>>();

                // Get the parameter description.
                let rhs = unwrap!(cells.next(), None => { break });

                // Execute the callback.
                match callback(&names, &rhs) {
                    Status::Done => return Ok(()),
                    Status::KeepGoing => {},
                };

            }

            // If we got here, we managed to find and parse the argument table.
            break;

        }

        Ok(())

    }

    pub fn parameter(&self, name: &str) -> Result<Option<MarkupContent>> {

        let mut result = None;
        self.parameters(|params, node| {

            for param in params {
                if *param == name {
                    result = Some(MarkupContent {
                        kind: MarkupKind::Markdown,
                        value: MarkdownConverter::new(**node).convert(),
                    });
                    return Status::Done;
                }
            }

            return Status::KeepGoing;

        })?;

        Ok(result)

    }

    pub fn markdown(&self) -> Result<String> {

        let mut markdown = String::new();

        // add topic
        if let Some(topic) = self.topic() {
            push!(markdown, md_italic(&topic), md_newline());
        }

        if let Some(title) = self.title() {
            push!(markdown, md_h2(&title), md_newline(), "------\n");
        }

        // iterate through the different sections in the help file
        for_each_section(&self.html, |header, elements| {

            // add a title
            let header = elt_text(header);
            markdown.push_str(md_h3(header.as_str()).as_str());
            markdown.push_str(md_newline().as_str());

            // add body
            let body = if matches!(header.as_str(), "Usage" | "Examples") {
                let mut buffer = String::new();
                for elt in elements {
                    if elt.value().name() == "hr" { break }
                    let code = md_codeblock("r", elt_text(elt).as_str());
                    buffer.push_str(code.as_str());
                }
                buffer
            } else if matches!(header.as_str(), "Arguments") {
                // create a buffer for table output
                let mut buffer = String::new();

                // add an empty header
                buffer.push_str("|     |     |\n");
                buffer.push_str("| --- | --- |");

                // generate the markdown table
                for elt in elements {
                    let converter = MarkdownConverter::new(*elt);
                    let table = converter.convert();
                    buffer.push_str(table.as_str());
                }

                buffer
            } else {
                let mut buffer = String::new();
                for elt in elements {
                    let converter = MarkdownConverter::new(*elt);
                    let markdown = converter.convert();
                    buffer.push_str(markdown.as_str());
                }

                buffer
            };

            markdown.push_str(body.as_str());
            markdown.push_str(md_newline().as_str());
        });

        Ok(markdown)

    }

}

fn for_each_section(doc: &Html, mut callback: impl FnMut(ElementRef, Vec<ElementRef>)) {

    // find all h3 headers in the document
    let selector = Selector::parse("h3").unwrap();
    let headers = doc.select(&selector);

    // iterate through them, and pass each (+ the 'body' of the node) to the callback
    for header in headers {

        // collect all the elements following up to the next header
        let mut elements: Vec<ElementRef> = Vec::new();

        // start with the current header
        let mut elt = header;

        // find the next element -- we might need to skip interleaving nodes
        loop {

            // get the next element (if any)
            elt = unwrap!(elt_next(elt), None => { break });

            // if we find a header, assume that's the start of the next section
            if matches!(elt.value().name(), "h1" | "h2" | "h3") { break }

            // add it to our list of elements
            elements.push(elt);

        }

        // execute the callback
        callback(header, elements);

    }

}


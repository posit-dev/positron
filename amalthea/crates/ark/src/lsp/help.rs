//
// help.rs
//
// Copyright (C) 2022 by Posit, PBC
//
//

use anyhow::*;
use harp::exec::RFunction;
use harp::exec::RFunctionExt;
use scraper::ElementRef;
use scraper::Html;
use scraper::Selector;
use stdext::push;
use stdext::unwrap;
use stdext::unwrap::IntoResult;

use crate::lsp::markdown::*;

pub struct RHtmlHelp {
    html: Html,
}

impl RHtmlHelp {

    pub unsafe fn new(topic: &str, package: Option<&str>) -> Result<Self> {

        // get help document
        let contents = RFunction::from(".rs.help.getHtmlHelpContents")
            .param("topic", topic)
            .param("package", package)
            .call()?
            .to::<String>()?;

        // parse as html
        let html = Html::parse_document(contents.as_str());
        Ok(Self { html })

    }



    pub fn markdown(&self) -> Result<String> {

        let mut markdown = String::new();

        // get topic + title; normally available in first table in the document
        let selector = Selector::parse("table").unwrap();
        let preamble = self.html.select(&selector).next().into_result()?;

        // try to get the first cell
        let selector = Selector::parse("td").unwrap();
        let cell = preamble.select(&selector).next().into_result()?;
        let preamble = elt_text(cell);
        push!(markdown, md_italic(&preamble), md_newline());

        // get title
        let selector = Selector::parse("head > title").unwrap();
        let title = self.html.select(&selector).next().into_result()?;
        let mut title = elt_text(title);

        // R prepends 'R: ' to the title, so remove it if that exists
        if title.starts_with("R: ") {
            title.replace_range(0..3, "");
        }

        push!(markdown, md_h2(&title), md_newline(), "------\n");

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


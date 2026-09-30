/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

//! Driving the analyzer the way the extension does: a JSON request in, a JSON response out.
//!
//! Tests go through [`request`] rather than calling the modules directly, so that what they pin
//! down is the contract the TypeScript side depends on, offsets included.

#![allow(dead_code)]

use serde_json::Value;

/// A document with the cursor written as `|`, split into its text and the cursor's offset.
///
/// Every completion case is SQL halfway through being typed and the offset is the whole question,
/// so it is written into the SQL rather than counted out by hand beside it. Counted in UTF-16
/// units, like every offset the analyzer deals in, so a case may hold an emoji.
pub fn cursor(marked: &str) -> (String, u32) {
    let (before, after) = marked.split_once('|').expect("the text marks the cursor with |");
    (format!("{before}{after}"), before.encode_utf16().count() as u32)
}

pub fn request(request: Value) -> Value {
    let response = positron_sql_analyzer::api::handle(&request.to_string());
    serde_json::to_value(response).expect("the response serializes")
}

pub fn analyze(text: &str) -> Value {
    request(serde_json::json!({ "op": "analyze", "text": text }))
}

pub fn analyze_as(dialect: &str, text: &str) -> Value {
    request(serde_json::json!({ "op": "analyze", "dialect": dialect, "text": text }))
}

/// The diagnostics of a document, as `(the text under the squiggle, the message)`.
///
/// Sliced out of the document rather than compared as offsets: a range is only right if it covers
/// the thing it is meant to point at, and the text says that in a way two numbers do not.
pub fn diagnostics(text: &str) -> Vec<(String, String)> {
    diagnostics_of(&analyze(text), text)
}

pub fn diagnostics_of(response: &Value, text: &str) -> Vec<(String, String)> {
    response["diagnostics"]
        .as_array()
        .expect("diagnostics are an array")
        .iter()
        .map(|diagnostic| {
            (
                slice(text, diagnostic),
                diagnostic["message"].as_str().unwrap_or_default().to_string(),
            )
        })
        .collect()
}

/// The text a range covers, in the UTF-16 units the analyzer reports offsets in.
pub fn slice(text: &str, ranged: &Value) -> String {
    let units: Vec<u16> = text.encode_utf16().collect();
    let start = ranged["start"].as_u64().unwrap_or(0) as usize;
    let end = (ranged["end"].as_u64().unwrap_or(0) as usize).min(units.len());
    String::from_utf16_lossy(&units[start.min(end)..end])
}

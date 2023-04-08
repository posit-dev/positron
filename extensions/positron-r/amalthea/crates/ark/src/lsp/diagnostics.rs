//
// diagnostics.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

use tower_lsp::lsp_types::Diagnostic;
// use tower_lsp::lsp_types::Position;
// use tower_lsp::lsp_types::Range;
use tower_lsp::lsp_types::Url;
use tower_lsp::Client;

use crate::lsp::documents::Document;
// use crate::lsp::traits::cursor::TreeCursorExt;
// use crate::lsp::traits::point::PointExt;

pub async fn enqueue_diagnostics(client: Client, uri: Url, _doc: &Document) {
    // TODO: use a timer or something similar to debounce
    // diagnostics requests
    let diagnostics: Vec<Diagnostic> = Vec::new();
    {
        // TODO: do diagnostics things here
    }

    if diagnostics.is_empty() {
        return;
    }

    client.publish_diagnostics(uri, diagnostics, None).await;
}

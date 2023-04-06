//
// editor.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

use harp::vector::CharacterVector;
use harp::vector::Vector;
use libR_sys::*;
use tokio::runtime::Runtime;
use tower_lsp::lsp_types::ShowDocumentParams;
use tower_lsp::lsp_types::Url;

use crate::lsp::globals::lsp_client;

#[harp::register]
unsafe extern "C" fn ps_editor(file: SEXP, _title: SEXP) -> SEXP {
    let rt = Runtime::new().unwrap();
    let files = CharacterVector::new_unchecked(file);
    for file in files.iter() {
        if let Some(file) = file {
            rt.block_on(async move {
                let client = lsp_client();
                client
                    .show_document(ShowDocumentParams {
                        uri: Url::from_file_path(file).unwrap(),
                        external: Some(false),
                        take_focus: Some(true),
                        selection: None,
                    })
                    .await
                    .unwrap();
            });
        }
    }

    file
}

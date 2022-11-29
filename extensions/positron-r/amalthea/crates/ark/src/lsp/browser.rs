//
// browser.rs
//
// Copyright (C) 2022 by Posit, PBC
//
//

use libR_sys::*;
use tokio::runtime::Runtime;
use tower_lsp::lsp_types::MessageType;

use crate::lsp::backend::CLIENT;

#[harp::register]
pub unsafe extern "C" fn ps_browse_url(url: SEXP) -> SEXP {

    let runtime = Runtime::new().unwrap();
    runtime.block_on(async move {
        let client = CLIENT.get().unwrap().lock();
        client.log_message(MessageType::INFO, "This is a message from an R callback!").await;
    });

    R_NilValue
}

//
// browser.rs
//
// Copyright (C) 2022 by Posit, PBC
//
//

use libR_sys::*;
use tokio::runtime::Handle;
use tower_lsp::lsp_types::MessageType;

use crate::lsp::backend::CLIENT;

pub unsafe extern "C" fn ps_browse_url() -> SEXP {

    let handle = Handle::current();
    handle.spawn(async move {
        let client = CLIENT.get().unwrap();
        client.log_message(MessageType::ERROR, "This is a message!").await;
    });

    R_NilValue
}


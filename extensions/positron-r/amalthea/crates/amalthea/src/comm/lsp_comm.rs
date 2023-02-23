/*
 * lsp_comm.rs
 *
 * Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *
 */

use std::sync::Arc;
use std::sync::Mutex;

use serde_json::Value;

use crate::comm::comm_channel::CommChannel;
use crate::error::Error;
use crate::language::lsp_handler::LspHandler;

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct StartLsp {
    /// The address on which the client is listening for LSP requests.
    pub client_address: String,
}

pub struct LspComm {
    handler: Arc<Mutex<dyn LspHandler>>
}

/**
 * LspComm makes an LSP look like a CommChannel; it's used to start the LSP and
 * track the server thread.
 */
impl LspComm {
    pub fn new(handler: Arc<Mutex<dyn LspHandler>>) -> LspComm {
        LspComm {
            handler
        }
    }

    pub fn start(&self, data: &StartLsp) ->  Result<(), Error> {
        let mut handler = self.handler.lock().unwrap();
        handler.start(data.client_address.clone()).unwrap();
        Ok(())
    }
}

impl CommChannel for LspComm {
    fn send_request(&self, _data: &Value) {
        // Not implemented; LSP messages are delivered directly to the LSP
        // handler via TCP, not proxied here.
    }

    fn target_name(&self) -> String {
        "lsp".to_string()
    }

    fn close(&self) {
        // Not implemented; the LSP is closed automatically when the TCP
        // connection is closed.
    }
}
/*
 * lsp_comm.rs
 *
 * Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *
 */

use std::sync::Arc;
use std::sync::Mutex;

use serde_json::Value;
use serde_json::json;

use crate::comm::comm_channel::CommChannel;
use crate::error::Error;
use crate::language::lsp_handler::LspHandler;

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct StartLsp {
    /// The address on which the client is listening for LSP requests.
    pub client_address: String,
}

pub struct LspComm<F>
where F: Fn(Value) -> () {
    handler: Arc<Mutex<dyn LspHandler>>,
    msg_emitter: F,
}

/**
 * LspComm makes an LSP look like a CommChannel; it's used to start the LSP and
 * track the server thread.
 */
impl<F> LspComm<F>
where F: Fn(Value) -> () {
    pub fn new(handler: Arc<Mutex<dyn LspHandler>>, msg_emitter: F) -> LspComm<F> {
        LspComm {
            handler,
            msg_emitter,
        }
    }

    pub fn start(&self, data: &StartLsp) ->  Result<(), Error> {
        let mut handler = self.handler.lock().unwrap();
        handler.start(data.client_address.clone()).unwrap();
        (self.msg_emitter)(json!({
            "msg_type": "lsp_started",
            "content": {}
        }));
        Ok(())
    }
}

impl<F> CommChannel for LspComm<F>
where F: Fn(Value) -> () + Send {
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
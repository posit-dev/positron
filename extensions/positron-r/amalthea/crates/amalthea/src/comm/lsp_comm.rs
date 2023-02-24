/*
 * lsp_comm.rs
 *
 * Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *
 */

use std::sync::Arc;
use std::sync::Mutex;

use crossbeam::channel::Sender;
use serde_json::json;
use serde_json::Value;

use crate::error::Error;
use crate::language::lsp_handler::LspHandler;

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct StartLsp {
    /// The address on which the client is listening for LSP requests.
    pub client_address: String,
}

pub struct LspComm {
    handler: Arc<Mutex<dyn LspHandler>>,
    msg_tx: Sender<Value>,
}

/**
 * LspComm makes an LSP look like a CommChannel; it's used to start the LSP and
 * track the server thread.
 */
impl LspComm {
    pub fn new(handler: Arc<Mutex<dyn LspHandler>>, msg_tx: Sender<Value>) -> LspComm {
        LspComm { handler, msg_tx }
    }

    pub fn start(&self, data: &StartLsp) -> Result<(), Error> {
        let mut handler = self.handler.lock().unwrap();
        handler.start(data.client_address.clone()).unwrap();
        self.msg_tx.send(json!({
            "msg_type": "lsp_started",
            "content": {}
        }));
        Ok(())
    }

    pub fn msg_rx(&self) -> Sender<Value> {
        let (msg_tx, msg_rx) = crossbeam::channel::unbounded();
        msg_tx
    }
}

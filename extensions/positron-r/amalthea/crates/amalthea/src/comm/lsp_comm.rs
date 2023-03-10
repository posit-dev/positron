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

use crate::comm::comm_channel::CommChannelMsg;
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
    msg_tx: Sender<CommChannelMsg>,
}

/**
 * LspComm makes an LSP look like a CommChannel; it's used to start the LSP and
 * track the server thread.
 */
impl LspComm {
    pub fn new(handler: Arc<Mutex<dyn LspHandler>>, msg_tx: Sender<CommChannelMsg>) -> LspComm {
        LspComm { handler, msg_tx }
    }

    pub fn start(&self, data: &StartLsp) -> Result<(), Error> {
        let mut handler = self.handler.lock().unwrap();
        handler.start(data.client_address.clone()).unwrap();
        self.msg_tx
            .send(CommChannelMsg::Data(json!({
                "msg_type": "lsp_started",
                "content": {}
            })))
            .unwrap();
        Ok(())
    }

    /**
     * Returns a Sender that can accept comm channel messages (required as part of the
     * `CommChannel` contract). Because the LSP communicates over its own TCP connection, it does
     * not process messages from the comm, and they are discarded here.
     */
    pub fn msg_sender(&self) -> Sender<CommChannelMsg> {
        let (msg_tx, _msg_rx) = crossbeam::channel::unbounded();
        msg_tx
    }
}

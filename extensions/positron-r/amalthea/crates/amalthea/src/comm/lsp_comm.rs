/*
 * lsp_comm.rs
 *
 * Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *
 */

use std::sync::Arc;
use std::sync::Mutex;
use std::thread;

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

impl LspComm {
    pub fn new(handler: Arc<Mutex<dyn LspHandler>>) -> LspComm {
        LspComm {
            handler
        }
    }

    pub fn start(&self, data: &StartLsp) ->  Result<(), Error> {
        let handler = self.handler.clone();
        let address = data.client_address.clone();
        thread::spawn(move || {
            let mut handler = handler.lock().unwrap();
            handler.start(address).unwrap();
        });
        let json = serde_json::to_value(data).unwrap();
        self.send_request(&json);
        Ok(())
    }
}

impl CommChannel for LspComm {
    fn send_request(&self, data: &Value) {
        println!("LspComm::send_request - data: {:?}", data);
    }

    fn target_name(&self) -> String {
        "lsp".to_string()
    }

    fn close(&self) {
        println!("LspComm::close");
    }
}
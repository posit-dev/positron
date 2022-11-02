//
// handler.rs
//
// Copyright (C) 2022 by Posit, PBC
//
//

use std::{sync::mpsc::SyncSender, time::Duration};

use amalthea::language::lsp_handler::LspHandler;
use async_trait::async_trait;
use std::thread;

use crate::request::Request;

use super::backend;

extern "C" {
static R_Is_Running: i32;
}

pub struct Lsp {
    req_sender: SyncSender<Request>
}

impl Lsp {
    pub fn new(req_sender: SyncSender<Request>) -> Self {
        Self {
            req_sender
        }
    }
}

#[async_trait]
impl LspHandler for Lsp {
    fn start(&self, tcp_address: String) -> Result<(), amalthea::error::Error>  {
        let sender = self.req_sender.clone();
        thread::spawn(move || {

            // Is there a better way? Perhaps we should initialize the LSP
            // from one of the R callbacks; e.g. in R_ReadConsole. This
            // is the strategy used by RStudio for detecting when the R
            // session is "ready" for extension pieces to be loaded.
            //
            // Or perhaps we should be loading R extensions in the main
            // thread, rather than asking the LSP to handle this during
            // its own initialization.
            unsafe {
               while R_Is_Running != 2 {
                   std::thread::sleep(Duration::from_millis(200));
               }
            }

            // R appears to be ready; start the backend.
            backend::start_lsp(tcp_address, sender);
        });
        return Ok(());
    }
}
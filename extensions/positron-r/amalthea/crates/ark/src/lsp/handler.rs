//
// handler.rs
//
// Copyright (C) 2022 by Posit Software, PBC
//
//

use std::sync::mpsc::SyncSender;

use amalthea::language::lsp_handler::LspHandler;
use async_trait::async_trait;
use std::thread;

use crate::request::Request;

use super::backend;

pub struct Lsp {
    shell_request_sender: SyncSender<Request>
}

impl Lsp {
    pub fn new(shell_request_sender: SyncSender<Request>) -> Self {
        Self { shell_request_sender }
    }
}

#[async_trait]
impl LspHandler for Lsp {
    fn start(&self, tcp_address: String) -> Result<(), amalthea::error::Error> {
        let sender = self.shell_request_sender.clone();
        thread::spawn(move || backend::start_lsp(tcp_address, sender));
        return Ok(());
    }
}

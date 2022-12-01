//
// global.rs
//
// Copyright (C) 2022 by Posit, PBC
//
//

use std::sync::mpsc::SyncSender;
use tower_lsp::Client;
use crate::request::Request;
use once_cell::sync::OnceCell;

#[derive(Debug, Clone)]
pub struct ClientInstance {
    pub client: Client,
    pub channel: SyncSender<Request>
}

// This global instance of the LSP client and request channel is used for
// context in the R callback functions.
pub static INSTANCE: OnceCell<ClientInstance> = OnceCell::new();

pub fn get_instance() -> ClientInstance {
    INSTANCE.get().unwrap().clone()
}

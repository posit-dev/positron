//
// global.rs
//
// Copyright (C) 2022 by Posit Software, PBC
//
//

use crossbeam::channel::Sender;
use tower_lsp::Client;
use once_cell::sync::OnceCell;

use crate::request::Request;

#[derive(Debug, Clone)]
pub struct ClientInstance {
    pub client: Client,
    pub shell_request_sender: Sender<Request>
}

// This global instance of the LSP client and request channel is used for
// context in the R callback functions.
pub static INSTANCE: OnceCell<ClientInstance> = OnceCell::new();

pub fn get_instance() -> ClientInstance {
    INSTANCE.get().unwrap().clone()
}

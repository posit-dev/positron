//
// global.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

use amalthea::comm::event::CommEvent;
use crossbeam::channel::Sender;
use once_cell::sync::OnceCell;
use parking_lot::Mutex;
use tower_lsp::Client;

use crate::request::Request;

// The LSP client.
// For use within R callback functions.
pub static LSP_CLIENT: OnceCell<Mutex<Client>> = OnceCell::new();

// The shell request channel.
// For use within R callback functions.
pub static SHELL_REQUEST_TX: OnceCell<Mutex<Sender<Request>>> = OnceCell::new();

// The communication channel manager's request channel.
// For use within R callback functions.
pub static COMM_MANAGER_TX: OnceCell<Mutex<Sender<CommEvent>>> = OnceCell::new();

pub fn initialize(
    lsp_client: Client,
    shell_request_tx: Sender<Request>,
    comm_manager_tx: Sender<CommEvent>,
) {
    LSP_CLIENT.set(Mutex::new(lsp_client)).unwrap();
    SHELL_REQUEST_TX.set(Mutex::new(shell_request_tx)).unwrap();
    COMM_MANAGER_TX.set(Mutex::new(comm_manager_tx)).unwrap();
}

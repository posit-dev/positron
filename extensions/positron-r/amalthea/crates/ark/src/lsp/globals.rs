//
// globals.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

use amalthea::comm::event::CommEvent;
use crossbeam::channel::Sender;
use parking_lot::Mutex;
use parking_lot::MutexGuard;
use tower_lsp::Client;

use crate::request::Request;

// The LSP client.
// For use within R callback functions.
static mut LSP_CLIENT: Option<Mutex<Client>> = None;

// The shell request channel.
// For use within R callback functions.
static mut SHELL_REQUEST_TX: Option<Mutex<Sender<Request>>> = None;

// The communication channel manager's request channel.
// For use within R callback functions.
static mut COMM_MANAGER_TX: Option<Mutex<Sender<CommEvent>>> = None;

pub fn lsp_client<'a>() -> MutexGuard<'a, Client> {
    unsafe { LSP_CLIENT.as_ref().unwrap_unchecked().lock() }
}

pub fn shell_request_tx<'a>() -> MutexGuard<'a, Sender<Request>> {
    unsafe { SHELL_REQUEST_TX.as_ref().unwrap_unchecked().lock() }
}

pub fn comm_manager_tx<'a>() -> MutexGuard<'a, Sender<CommEvent>> {
    unsafe { COMM_MANAGER_TX.as_ref().unwrap_unchecked().lock() }
}

pub fn initialize(
    lsp_client: Client,
    shell_request_tx: Sender<Request>,
    comm_manager_tx: Sender<CommEvent>,
) {
    unsafe {
        LSP_CLIENT = Some(Mutex::new(lsp_client));
        SHELL_REQUEST_TX = Some(Mutex::new(shell_request_tx));
        COMM_MANAGER_TX = Some(Mutex::new(comm_manager_tx));
    }
}

//
// global.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

use std::sync::Mutex;

use crossbeam::channel::Sender;
use tower_lsp::Client;

use crate::request::Request;

// The LSP client.
// For use within R callback functions.
pub static LSP_CLIENT: Mutex<Option<Client>> = Mutex::new(None);

// The shell request channel.
// For use within R callback functions.
pub static SHELL_REQUEST_TX: Mutex<Option<Sender<Request>>> = Mutex::new(None);


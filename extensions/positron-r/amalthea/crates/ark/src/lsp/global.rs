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

// The LSP client.
// For use within R callback functions.
pub static LSP_CLIENT: OnceCell<Client> = OnceCell::new();

// The shell request channel.
// For use within R callback functions.
pub static SHELL_REQUEST_TX: OnceCell<Sender<Request>> = OnceCell::new();


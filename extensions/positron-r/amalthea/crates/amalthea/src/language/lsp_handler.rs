/*
 * lsp_handler.rs
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 */

use async_trait::async_trait;

use crate::error::Error;

/// A trait for handling LSP requests. Not all kernels will support an embedded
/// LSP that communicates over TCP, so this trait is an optional addition for
/// Amalthea-based kernels.
#[async_trait]
pub trait LspHandler: Send {
    /// Starts the LSP server and binds it to the given TCP address.
    fn start(&mut self, tcp_address: String) -> Result<(), Error>;
}

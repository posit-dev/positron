/*
 * lsp_handler.rs
 *
 * Copyright (C) 2022 by RStudio, PBC
 *
 */

use async_trait::async_trait;

#[async_trait]
pub trait LspHandler: Send {
}

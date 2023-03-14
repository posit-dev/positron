/*
 * comm_channel.rs
 *
 * Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *
 */

use serde_json::Value;
use strum_macros::EnumString;

#[derive(EnumString, PartialEq)]
#[strum(serialize_all = "snake_case")]
pub enum Comm {
    /// The Environment pane.
    Environment,

    /// A wrapper for a Language Server Protocol server.
    Lsp,

    /// Some other comm with a custom name.
    Other(String),
}

#[derive(Debug, PartialEq)]
pub enum CommChannelMsg {
    Data(Value),
    Close,
}

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

    /// A dynamic (resizable) plot.
    Plot,

    /// A data viewer.
    DataViewer,

    /// Some other comm with a custom name.
    Other(String),
}

#[derive(Debug, PartialEq)]
pub enum CommChannelMsg {
    /// A message that is part of a Remote Procedure Call (RPC). The first value
    /// is the unique ID of the RPC invocation (i.e. the Jupyter message ID),
    /// and the second value is the data associated with the RPC (the request or
    /// response).
    Rpc(String, Value),

    /// A message representing any other data sent on the comm channel; usually
    /// used for events.
    Data(Value),

    // A message indicating that the comm channel should be closed.
    Close,
}

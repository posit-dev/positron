/*
 * input_request.rs
 *
 * Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *
 */

use crate::wire::jupyter_message::MessageType;
use serde::{Deserialize, Serialize};

/// Represents a request from the kernel to the front end to prompt the user for
/// input
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct InputRequest {
    /// The prompt to display to the user
    pub prompt: String,

    /// Whether the string being requested is a password (and should therefore
    /// be obscured)
    pub password: bool,
}

/// An input request originating from a Shell handler
pub struct ShellInputRequest {
    /// The identity of the Shell that sent the request
    pub originator: Vec<u8>,

    /// The input request itself
    pub request: InputRequest,
}

impl MessageType for InputRequest {
    fn message_type() -> String {
        String::from("input_request")
    }
}

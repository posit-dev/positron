/*
 * input_reply.rs
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 */

use crate::wire::jupyter_message::MessageType;
use serde::{Deserialize, Serialize};

/// Represents a reply from the front end to the kernel delivering the response
/// to an `input_request`
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct InputReply {
    /// The value the user entered
    pub value: String,
}

impl MessageType for InputReply {
    fn message_type() -> String {
        String::from("input_reply")
    }
}

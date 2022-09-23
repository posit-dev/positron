/*
 * interrupt_reply.rs
 *
 * Copyright (C) 2022 by RStudio, PBC
 *
 */

use crate::wire::jupyter_message::MessageType;
use crate::wire::jupyter_message::Status;
use serde::{Deserialize, Serialize};

/// Represents an exception that occurred while executing code
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct InterruptReply {
    /// The status; always Ok
    pub status: Status,
}

impl MessageType for InterruptReply {
    fn message_type() -> String {
        String::from("interrupt_reply")
    }
}

/*
 * is_complete_reply.rs
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 */

use crate::wire::jupyter_message::MessageType;
use serde::{Deserialize, Serialize};

/// Represents a reply to an is_complete_request.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IsCompleteReply {
    /// The status of the code: one of Complete, Incomplete, Invalid, or Unknown
    pub status: IsComplete,

    /// Characters to use for indenting the next line (if incomplete)
    pub indent: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub enum IsComplete {
    /// The submitted code is complete as written.
    Complete,

    /// The submitted code is not complete.
    Incomplete,

    /// The submitted code is invalid syntax.
    Invalid,

    /// The state of the code could not be determined.
    Unknown,
}

impl MessageType for IsCompleteReply {
    fn message_type() -> String {
        String::from("is_complete_reply")
    }
}

/*
 * complete_reply.rs
 *
 * Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *
 */

use crate::wire::jupyter_message::MessageType;
use crate::wire::jupyter_message::Status;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Represents completion possibilities for a code fragment supplied by the front end.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CompleteReply {
    /// The status of the completion request.
    pub status: Status,

    /// A list of matches for the completion request.
    pub matches: Vec<String>,

    /// The starting position of the text to be replaced by a match.
    pub cursor_start: u32,

    /// The ending position of the text to be replaced by a match.
    pub cursor_end: u32,

    /// Additional metadata, if any
    pub metadata: Value,
}

impl MessageType for CompleteReply {
    fn message_type() -> String {
        String::from("complete_reply")
    }
}

/*
 * stream.rs
 *
 * Copyright (C) 2022 by RStudio, PBC
 *
 */

use crate::wire::jupyter_message::MessageType;
use serde::{Deserialize, Serialize};

/// Represents a message from the front end to indicate stream output
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StreamOutput {
    /// The stream for which output is being emitted
    pub stream: Stream,

    /// The output emitted on the stream
    pub text: String,
}

impl MessageType for StreamOutput {
    fn message_type() -> String {
        String::from("stream")
    }
}

#[derive(Debug, Serialize, Deserialize, Copy, Clone, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Stream {
    /// Standard output
    Stdout,

    /// Standard error
    Stderr,
}

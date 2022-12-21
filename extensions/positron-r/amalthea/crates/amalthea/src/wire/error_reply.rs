/*
 * error_reply.rs
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 */

use crate::wire::exception::Exception;
use crate::wire::jupyter_message::MessageType;
use crate::wire::jupyter_message::Status;
use serde::{Deserialize, Serialize};

/// Represents an error that occurred after processing a request on a
/// ROUTER/DEALER socket
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ErrorReply {
    /// The status; always Error
    pub status: Status,

    /// The exception that occurred during execution
    #[serde(flatten)]
    pub exception: Exception,
}

/// Note that the message type of an error reply is generally adjusted to match
/// its request type (e.g. foo_request => foo_reply)
impl MessageType for ErrorReply {
    fn message_type() -> String {
        String::from("error")
    }
}

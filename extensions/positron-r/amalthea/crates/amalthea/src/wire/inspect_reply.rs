/*
 * inspect_reply.rs
 *
 * Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *
 */

use crate::wire::jupyter_message::MessageType;
use crate::wire::jupyter_message::Status;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Represents a reply from the kernel giving code inspection results
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct InspectReply {
    /// The status of the request (usually Ok)
    pub status: Status,

    /// True if an object was found
    pub found: bool,

    /// MIME bundle giving information about the object
    pub data: Value,

    /// Additional metadata
    pub metadata: Value,
}

impl MessageType for InspectReply {
    fn message_type() -> String {
        String::from("inspect_reply")
    }
}

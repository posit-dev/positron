/*
 * comm_info_request.rs
 *
 * Copyright (C) 2022 by RStudio, PBC
 *
 */

use crate::wire::jupyter_message::MessageType;
use crate::wire::jupyter_message::Status;
use serde::{Deserialize, Serialize};

/// Represents a reply from the kernel listing open comms
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CommInfoReply {
    /// The status of the request (usually "ok")
    pub status: Status,

    /// Dictionary of comms, indexed by UUID
    pub comms: serde_json::Value,
}

impl MessageType for CommInfoReply {
    fn message_type() -> String {
        String::from("comm_info_reply")
    }
}

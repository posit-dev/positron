/*
 * comm_msg.rs
 *
 * Copyright (C) 2022 by Posit, PBC
 *
 */

use crate::wire::jupyter_message::MessageType;
use serde::{Deserialize, Serialize};

/// Represents a message on a custom comm channel.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CommMsg {
    pub comm_id: String,
    pub data: serde_json::Value,
}

impl MessageType for CommMsg {
    fn message_type() -> String {
        String::from("comm_msg")
    }
}

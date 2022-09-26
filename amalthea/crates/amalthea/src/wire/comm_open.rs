/*
 * comm_open.rs
 *
 * Copyright (C) 2022 by RStudio, PBC
 *
 */

use crate::wire::jupyter_message::MessageType;
use serde::{Deserialize, Serialize};

/// Represents a request to open a custom comm
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CommOpen {
    pub comm_id: String,
    pub target_name: String,
    pub data: serde_json::Value,
}

impl MessageType for CommOpen {
    fn message_type() -> String {
        String::from("comm_open")
    }
}

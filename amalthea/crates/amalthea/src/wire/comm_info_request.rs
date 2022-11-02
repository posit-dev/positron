/*
 * comm_info_request.rs
 *
 * Copyright (C) 2022 by Posit, PBC
 *
 */

use crate::wire::jupyter_message::MessageType;
use serde::{Deserialize, Serialize};

/// Represents a request from the front end to show open comms
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CommInfoRequest {
    pub target_name: String,
}

impl MessageType for CommInfoRequest {
    fn message_type() -> String {
        String::from("comm_info_request")
    }
}

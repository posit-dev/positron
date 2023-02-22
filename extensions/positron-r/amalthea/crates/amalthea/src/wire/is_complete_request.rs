/*
 * is_complete_request.rs
 *
 * Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *
 */

use crate::wire::jupyter_message::MessageType;
use serde::{Deserialize, Serialize};

/// Represents a request from the front end to test a code fragment to for
/// completeness.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IsCompleteRequest {
    pub code: String,
}

impl MessageType for IsCompleteRequest {
    fn message_type() -> String {
        String::from("is_complete_request")
    }
}

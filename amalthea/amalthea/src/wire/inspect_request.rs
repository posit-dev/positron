/*
 * inspect_request.rs
 *
 * Copyright (C) 2022 by RStudio, PBC
 *
 */

use crate::wire::jupyter_message::MessageType;
use serde::{Deserialize, Serialize};

/// Represents a request from the front end to inspect code
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct InspectRequest {
    /// The code context in which introspection is requested
    pub code: String,

    /// The cursor position within 'code', in Unicode characters
    pub cursor_pos: u32,

    /// The level of detail requested (0 or 1)
    pub detail_level: u32,
}

impl MessageType for InspectRequest {
    fn message_type() -> String {
        String::from("inspect_request")
    }
}

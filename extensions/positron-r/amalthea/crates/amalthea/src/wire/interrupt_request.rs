/*
 * interrupt_request.rs
 *
 * Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *
 */

use crate::wire::jupyter_message::MessageType;
use serde::{Deserialize, Serialize};

/// Represents request from the front end to the kernel to get information
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct InterruptRequest {}

impl MessageType for InterruptRequest {
    fn message_type() -> String {
        String::from("interrupt_request")
    }
}

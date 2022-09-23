/*
 * status.rs
 *
 * Copyright (C) 2022 by RStudio, PBC
 *
 */

use crate::wire::jupyter_message::MessageType;
use serde::{Deserialize, Serialize};

/// Represents a message the front end to communicate kernel status. These
/// messages are sent before/after handling every request.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct KernelStatus {
    /// The kernel's current status
    pub execution_state: ExecutionState,
}

impl MessageType for KernelStatus {
    fn message_type() -> String {
        String::from("status")
    }
}

#[derive(Debug, Serialize, Deserialize, Copy, Clone, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionState {
    /// The kernel is currently processing a request or executing code.
    Busy,

    /// The kernel is waiting for instructions.
    Idle,

    /// The kernel is starting up (sent only once!)
    Starting,
}

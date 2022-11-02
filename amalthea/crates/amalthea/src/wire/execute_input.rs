/*
 * execute_input.rs
 *
 * Copyright (C) 2022 by Posit, PBC
 *
 */

use crate::wire::jupyter_message::MessageType;
use serde::{Deserialize, Serialize};

/// Represents a rebroadcast of code input; used by the IOPUb channel so all
/// frontends can see what's being executed
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExecuteInput {
    /// The code being executed
    pub code: String,

    /// Monotonically increasing execution counter
    pub execution_count: u32,
}

impl MessageType for ExecuteInput {
    fn message_type() -> String {
        String::from("execute_input")
    }
}

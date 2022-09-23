/*
 * execute_result.rs
 *
 * Copyright (C) 2022 by RStudio, PBC
 *
 */

use crate::wire::jupyter_message::MessageType;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Represents a request from the front end to execute code
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExecuteResult {
    /// The data giving the result of the execution
    pub data: Value,

    /// A monotonically increasing execution counter
    pub execution_count: u32,

    /// Optional additional metadata
    pub metadata: Value,
}

impl MessageType for ExecuteResult {
    fn message_type() -> String {
        String::from("execute_result")
    }
}

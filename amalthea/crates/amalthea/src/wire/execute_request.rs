/*
 * execute_request.rs
 *
 * Copyright (C) 2022 by RStudio, PBC
 *
 */

use crate::wire::jupyter_message::MessageType;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Represents a request from the front end to execute code
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExecuteRequest {
    /// The code to be executed
    pub code: String,

    /// Whether the code should be executed silently (not shown to the user)
    pub silent: bool,

    /// Whether the code should be stored in history
    pub store_history: bool,

    /// Mapping of user expressions to be evaluated after code is executed.
    /// (TODO: should not be a plain value)
    pub user_expressions: Value,

    /// Whether to allow the kernel to send stdin requests
    pub allow_stdin: bool,

    /// Whether the kernel should discard the execution queue if evaluating the
    /// code results in an error
    pub stop_on_error: bool,
}

impl MessageType for ExecuteRequest {
    fn message_type() -> String {
        String::from("execute_request")
    }
}

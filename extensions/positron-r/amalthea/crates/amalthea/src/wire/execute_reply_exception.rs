/*
 * execute_reply_exception.rs
 *
 * Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *
 */

use crate::wire::exception::Exception;
use crate::wire::jupyter_message::MessageType;
use crate::wire::jupyter_message::Status;
use serde::{Deserialize, Serialize};

/// Represents an exception that occurred while executing code
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExecuteReplyException {
    /// The execution counter
    pub execution_count: u32,

    /// The status; always Error
    pub status: Status,

    /// The exception that occurred during execution
    #[serde(flatten)]
    pub exception: Exception,
}

impl MessageType for ExecuteReplyException {
    fn message_type() -> String {
        String::from("execute_reply")
    }
}

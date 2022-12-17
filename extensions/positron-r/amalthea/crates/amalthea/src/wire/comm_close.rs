/*
 * comm_close.rs
 *
 * Copyright (C) 2022 by Posit, PBC
 *
 */

use crate::wire::jupyter_message::MessageType;
use serde::{Deserialize, Serialize};

/// Represents a request to close a Jupyter communication channel that was
/// previously opened with a comm_open message.
///
/// (https://jupyter-client.readthedocs.io/en/stable/messaging.html#comm-close)
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CommClose {
    pub comm_id: String,
}

impl MessageType for CommClose {
    fn message_type() -> String {
        String::from("comm_close")
    }
}

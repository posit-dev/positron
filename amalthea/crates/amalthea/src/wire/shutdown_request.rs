/*
 * shutdown_request.rs
 *
 * Copyright (C) 2022 by RStudio, PBC
 *
 */

use crate::wire::jupyter_message::MessageType;
use serde::{Deserialize, Serialize};

/// Represents request from the front end to the kernel to get information
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ShutdownRequest {
    /// False if final shutdown; true if shutdown precedes a restart
    pub restart: bool,
}

impl MessageType for ShutdownRequest {
    fn message_type() -> String {
        String::from("shutdown_request")
    }
}

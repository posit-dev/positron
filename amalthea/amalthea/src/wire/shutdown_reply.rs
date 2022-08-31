/*
 * shutdown_reply.rs
 *
 * Copyright (C) 2022 by RStudio, PBC
 *
 */

use crate::wire::jupyter_message::MessageType;
use serde::{Deserialize, Serialize};

/// Represents reply from the kernel to a shutdown request.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ShutdownReply {
    /// False if final shutdown; true if shutdown precedes a restart
    pub restart: bool,
}

impl MessageType for ShutdownReply {
    fn message_type() -> String {
        String::from("shutdown_reply")
    }
}

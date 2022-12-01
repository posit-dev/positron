/*
 * show_message.rs
 *
 * Copyright (C) 2022 by Posit, PBC
 *
 */

use crate::event::positron_event::PositronEventType;
use serde::{Deserialize, Serialize};

/// Represents a message shown to the user
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ShowMessageEvent {
    /// The message to show to the user
    pub message: String,
}

/// Note that the message type of an error reply is generally adjusted to match
/// its request type (e.g. foo_request => foo_reply)
impl PositronEventType for ShowMessageEvent {
    fn event_type(&self) -> String {
        String::from("show_message")
    }
}

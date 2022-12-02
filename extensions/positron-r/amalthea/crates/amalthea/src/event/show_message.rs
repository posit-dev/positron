/*
 * show_message.rs
 *
 * Copyright (C) 2022 by Posit, PBC
 *
 */

use crate::event::positron_event::PositronEventType;
use crate::positron;
use serde::{Deserialize, Serialize};

/// Represents a message shown to the user
#[derive(Debug, Serialize, Deserialize, Clone)]
#[positron::event("show_message")]
pub struct ShowMessageEvent {
    /// The message to show to the user
    pub message: String,
}

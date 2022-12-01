/*
 * busy.rs
 *
 * Copyright (C) 2022 by Posit, PBC
 *
 */

use crate::event::positron_event::PositronEventType;
use serde::{Deserialize, Serialize};

/// Represents a change in the runtime's busy state. Note that this represents
/// the busy state of the underlying computation engine, not the busy state of
/// the kernel; the kernel is busy when it is processing a request, but the
/// runtime is busy only when a computation is running.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BusyEvent {
    /// Whether the runtime is busy
    pub busy: bool,
}

/// Note that the message type of an error reply is generally adjusted to match
/// its request type (e.g. foo_request => foo_reply)
impl PositronEventType for BusyEvent {
    fn event_type(&self) -> String {
        String::from("busy")
    }
}

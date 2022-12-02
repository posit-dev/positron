/*
 * busy.rs
 *
 * Copyright (C) 2022 by Posit, PBC
 *
 */

use crate::event::positron_event::PositronEventType;
use crate::positron;
use serde::{Deserialize, Serialize};

/// Represents a change in the runtime's busy state. Note that this represents
/// the busy state of the underlying computation engine, not the busy state of
/// the kernel; the kernel is busy when it is processing a request, but the
/// runtime is busy only when a computation is running.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[positron::event("busy")]
pub struct BusyEvent {
    /// Whether the runtime is busy
    pub busy: bool,
}

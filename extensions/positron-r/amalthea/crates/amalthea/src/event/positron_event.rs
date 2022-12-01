/*
 * positron_event.rs
 *
 * Copyright (C) 2022 by Posit, PBC
 *
 */

use super::{show_message::ShowMessageEvent, busy::BusyEvent};

/// Trait used to extract the event type from an event (for serialization)
pub trait PositronEventType {
    fn event_type(&self) -> String;
}

#[derive(Clone)]
pub enum PositronEvent {
    ShowMessage(ShowMessageEvent),
    Busy(BusyEvent)
}

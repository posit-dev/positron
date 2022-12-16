/*
 * client_event.rs
 *
 * Copyright (C) 2022 by Posit, PBC
 *
 */

use crate::events::PositronEvent;
use crate::events::PositronEventType;
use crate::{wire::jupyter_message::MessageType};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ClientEvent {
    /// The name of the event
    pub name: String,

    /// A JSON object containing the data for the event
    pub data: Value,
}

impl MessageType for ClientEvent {
    fn message_type() -> String {
        String::from("client_event")
    }
}

pub trait WireEvent: PositronEventType + Serialize {}
impl<T> WireEvent for T where T: PositronEventType + Serialize {}

/** begin rust-client-event */
impl From<PositronEvent> for ClientEvent {
    fn from(event: PositronEvent) -> Self {
        match event {
            PositronEvent::Busy(data) => Self::as_evt(data),
            PositronEvent::ShowMessage(data) => Self::as_evt(data),
            PositronEvent::ShowHelp(data) => Self::as_evt(data),
        }
    }
}
/** end rust-client-event */

impl ClientEvent {

    pub fn as_evt<T: WireEvent>(event: T) -> Self {
        Self {
            name: event.event_type(),
            data: serde_json::to_value(event).unwrap(),
        }
    }
}

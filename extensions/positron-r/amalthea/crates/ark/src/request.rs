//
// request.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

use amalthea::{wire::execute_request::ExecuteRequest, events::PositronEvent};
use amalthea::wire::execute_response::ExecuteResponse;
use amalthea::wire::input_request::ShellInputRequest;
use crossbeam::channel::Sender;

/// Represents requests to the primary R execution thread.
#[derive(Debug, Clone)]
pub enum Request {
    /// Fulfill an execution request from the front end, producing either a
    /// Reply or an Exception
    ExecuteCode(ExecuteRequest, Vec<u8>, Sender<ExecuteResponse>),

    /// Establish a channel to the front end to send input requests
    EstablishInputChannel(Sender<ShellInputRequest>),

    /// Deliver an event to the front end
    DeliverEvent(PositronEvent),

    /// Shut down the R execution thread
    Shutdown(bool),
}

/*
 * iopub.rs
 *
 * Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *
 */

use crate::error::Error;
use crate::events::PositronEvent;
use crate::socket::socket::Socket;
use crate::wire::client_event::ClientEvent;
use crate::wire::comm_close::CommClose;
use crate::wire::comm_msg::CommMsg;
use crate::wire::execute_error::ExecuteError;
use crate::wire::execute_input::ExecuteInput;
use crate::wire::execute_result::ExecuteResult;
use crate::wire::header::JupyterHeader;
use crate::wire::jupyter_message::JupyterMessage;
use crate::wire::jupyter_message::ProtocolMessage;
use crate::wire::status::ExecutionState;
use crate::wire::status::KernelStatus;
use crate::wire::stream::StreamOutput;
use crossbeam::channel::Receiver;
use log::{trace, warn};

pub struct IOPub {
    /// The underlying IOPub socket
    socket: Socket,

    /// A channel that receives IOPub messages from other threads
    receiver: Receiver<IOPubMessage>,

    /// The current message context; attached to outgoing messages to pair
    /// outputs with the message that caused them.
    context: Option<JupyterHeader>,
}

/// Enumeration of all messages that can be delivered from the IOPub PUB/SUB
/// socket. These messages generally are created on other threads and then sent
/// via a channel to the IOPub thread.
pub enum IOPubMessage {
    Status(JupyterHeader, KernelStatus),
    ExecuteResult(ExecuteResult),
    ExecuteError(ExecuteError),
    ExecuteInput(ExecuteInput),
    Stream(StreamOutput),
    Event(PositronEvent),
    CommMsgReply(JupyterHeader, CommMsg),
    CommMsgEvent(CommMsg),
    CommClose(String),
}

impl IOPub {
    /// Create a new IOPub socket wrapper.
    ///
    /// * `socket` - The ZeroMQ socket that will deliver IOPub messages to
    ///   subscribed clients.
    /// * `receiver` - The receiver channel that will receive IOPub
    ///   messages from other threads.
    pub fn new(socket: Socket, receiver: Receiver<IOPubMessage>) -> Self {
        Self {
            socket: socket,
            receiver: receiver,
            context: None,
        }
    }

    /// Listen for IOPub messages from other threads. Does not return.
    pub fn listen(&mut self) {
        // Begin by emitting the starting state
        self.emit_state(ExecutionState::Starting);
        loop {
            let message = match self.receiver.recv() {
                Ok(m) => m,
                Err(err) => {
                    warn!("Failed to receive iopub message: {}", err);
                    continue;
                },
            };
            if let Err(err) = self.process_message(message) {
                warn!("Error delivering iopub message: {}", err)
            }
        }
    }

    /// Process an IOPub message from another thread.
    fn process_message(&mut self, message: IOPubMessage) -> Result<(), Error> {
        match message {
            IOPubMessage::Status(context, msg) => {
                // When we enter the Busy state as a result of a message, we
                // update the context. Future messages to IOPub name this
                // context in the parent header sent to the client; this makes
                // it possible for the client to associate events/output with
                // their originator without requiring us to thread the values
                // through the stack.
                if msg.execution_state == ExecutionState::Busy {
                    self.context = Some(context);
                }
                self.send_message(msg)
            },
            IOPubMessage::ExecuteResult(msg) => self.send_message(msg),
            IOPubMessage::ExecuteError(msg) => self.send_message(msg),
            IOPubMessage::ExecuteInput(msg) => self.send_message(msg),
            IOPubMessage::Stream(msg) => self.send_message(msg),
            IOPubMessage::CommMsgEvent(msg) => self.send_message(msg),
            IOPubMessage::CommMsgReply(header, msg) => self.send_message_with_header(header, msg),
            IOPubMessage::CommClose(comm_id) => self.send_message(CommClose { comm_id }),
            IOPubMessage::Event(msg) => self.send_event(msg),
        }
    }

    /// Send a message using the underlying socket with the given content. The
    /// parent message is assumed to be the current context.
    fn send_message<T: ProtocolMessage>(&self, content: T) -> Result<(), Error> {
        let msg = JupyterMessage::<T>::create(content, self.context.clone(), &self.socket.session);
        msg.send(&self.socket)
    }

    /// Send a message using the underlying socket with the given content and
    /// specific header. Used when the parent message is known by the message
    /// sender, typically in comm message replies.
    fn send_message_with_header<T: ProtocolMessage>(
        &self,
        header: JupyterHeader,
        content: T,
    ) -> Result<(), Error> {
        let msg = JupyterMessage::<T>::create(content, Some(header), &self.socket.session);
        msg.send(&self.socket)
    }

    /// Send an event
    fn send_event(&self, event: PositronEvent) -> Result<(), Error> {
        let msg = JupyterMessage::<ClientEvent>::create(
            ClientEvent::from(event),
            self.context.clone(),
            &self.socket.session,
        );
        msg.send(&self.socket)
    }

    /// Emits the given kernel state to the client.
    fn emit_state(&self, state: ExecutionState) {
        trace!("Entering kernel state: {:?}", state);
        if let Err(err) = JupyterMessage::<KernelStatus>::create(
            KernelStatus {
                execution_state: state,
            },
            None,
            &self.socket.session,
        )
        .send(&self.socket)
        {
            warn!("Could not emit kernel's state. {}", err)
        }
    }
}

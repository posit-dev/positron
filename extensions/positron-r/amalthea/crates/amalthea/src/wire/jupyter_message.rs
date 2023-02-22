/*
 * jupyter_message.rs
 *
 * Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *
 */

use crate::error::Error;
use crate::session::Session;
use crate::socket::socket::Socket;
use crate::wire::comm_info_reply::CommInfoReply;
use crate::wire::comm_info_request::CommInfoRequest;
use crate::wire::comm_msg::CommMsg;
use crate::wire::comm_open::CommOpen;
use crate::wire::comm_close::CommClose;
use crate::wire::complete_reply::CompleteReply;
use crate::wire::complete_request::CompleteRequest;
use crate::wire::error_reply::ErrorReply;
use crate::wire::exception::Exception;
use crate::wire::execute_error::ExecuteError;
use crate::wire::execute_input::ExecuteInput;
use crate::wire::execute_reply::ExecuteReply;
use crate::wire::execute_reply_exception::ExecuteReplyException;
use crate::wire::execute_request::ExecuteRequest;
use crate::wire::execute_result::ExecuteResult;
use crate::wire::header::JupyterHeader;
use crate::wire::input_reply::InputReply;
use crate::wire::input_request::InputRequest;
use crate::wire::inspect_reply::InspectReply;
use crate::wire::inspect_request::InspectRequest;
use crate::wire::interrupt_reply::InterruptReply;
use crate::wire::interrupt_request::InterruptRequest;
use crate::wire::is_complete_reply::IsCompleteReply;
use crate::wire::is_complete_request::IsCompleteRequest;
use crate::wire::kernel_info_reply::KernelInfoReply;
use crate::wire::kernel_info_request::KernelInfoRequest;
use crate::wire::shutdown_request::ShutdownRequest;
use crate::wire::status::KernelStatus;
use crate::wire::wire_message::WireMessage;
use serde::{Deserialize, Serialize};

use super::client_event::ClientEvent;

/// Represents a Jupyter message
#[derive(Debug, Clone)]
pub struct JupyterMessage<T> {
    /// The ZeroMQ identities (for ROUTER sockets)
    pub zmq_identities: Vec<Vec<u8>>,

    /// The header for this message
    pub header: JupyterHeader,

    /// The header of the message from which this message originated. Optional;
    /// not all messages have an originator.
    pub parent_header: Option<JupyterHeader>,

    /// The body (payload) of the message
    pub content: T,
}

/// Trait used to extract the wire message type from a Jupyter message
pub trait MessageType {
    fn message_type() -> String;
}

/// Convenience trait for grouping traits that must be present on all Jupyter
/// protocol messages
pub trait ProtocolMessage: MessageType + Serialize + std::fmt::Debug + Clone {}
impl<T> ProtocolMessage for T where T: MessageType + Serialize + std::fmt::Debug + Clone {}

/// List of all known/implemented messages
#[derive(Debug)]
pub enum Message {
    CompleteReply(JupyterMessage<CompleteReply>),
    CompleteRequest(JupyterMessage<CompleteRequest>),
    ExecuteReply(JupyterMessage<ExecuteReply>),
    ExecuteReplyException(JupyterMessage<ExecuteReplyException>),
    ExecuteRequest(JupyterMessage<ExecuteRequest>),
    ExecuteResult(JupyterMessage<ExecuteResult>),
    ExecuteError(JupyterMessage<ExecuteError>),
    ExecuteInput(JupyterMessage<ExecuteInput>),
    InputReply(JupyterMessage<InputReply>),
    InputRequest(JupyterMessage<InputRequest>),
    InspectReply(JupyterMessage<InspectReply>),
    InspectRequest(JupyterMessage<InspectRequest>),
    InterruptReply(JupyterMessage<InterruptReply>),
    InterruptRequest(JupyterMessage<InterruptRequest>),
    IsCompleteReply(JupyterMessage<IsCompleteReply>),
    IsCompleteRequest(JupyterMessage<IsCompleteRequest>),
    KernelInfoReply(JupyterMessage<KernelInfoReply>),
    KernelInfoRequest(JupyterMessage<KernelInfoRequest>),
    ShutdownRequest(JupyterMessage<ShutdownRequest>),
    Status(JupyterMessage<KernelStatus>),
    CommInfoReply(JupyterMessage<CommInfoReply>),
    CommInfoRequest(JupyterMessage<CommInfoRequest>),
    CommOpen(JupyterMessage<CommOpen>),
    CommMsg(JupyterMessage<CommMsg>),
    CommClose(JupyterMessage<CommClose>),
    ClientEvent(JupyterMessage<ClientEvent>),
}

/// Represents status returned from kernel inside messages.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Ok,
    Error,
}

/// Conversion from a `Message` to a `WireMessage`; used to send messages over a
/// socket
impl TryFrom<&Message> for WireMessage {
    type Error = crate::error::Error;

    fn try_from(msg: &Message) -> Result<Self, Error> {
        match msg {
            Message::CompleteReply(msg) => WireMessage::try_from(msg),
            Message::CompleteRequest(msg) => WireMessage::try_from(msg),
            Message::ExecuteReply(msg) => WireMessage::try_from(msg),
            Message::ExecuteReplyException(msg) => WireMessage::try_from(msg),
            Message::ExecuteRequest(msg) => WireMessage::try_from(msg),
            Message::ExecuteResult(msg) => WireMessage::try_from(msg),
            Message::ExecuteError(msg) => WireMessage::try_from(msg),
            Message::ExecuteInput(msg) => WireMessage::try_from(msg),
            Message::InputReply(msg) => WireMessage::try_from(msg),
            Message::InputRequest(msg) => WireMessage::try_from(msg),
            Message::InspectReply(msg) => WireMessage::try_from(msg),
            Message::InspectRequest(msg) => WireMessage::try_from(msg),
            Message::InterruptReply(msg) => WireMessage::try_from(msg),
            Message::InterruptRequest(msg) => WireMessage::try_from(msg),
            Message::IsCompleteReply(msg) => WireMessage::try_from(msg),
            Message::IsCompleteRequest(msg) => WireMessage::try_from(msg),
            Message::KernelInfoReply(msg) => WireMessage::try_from(msg),
            Message::KernelInfoRequest(msg) => WireMessage::try_from(msg),
            Message::ShutdownRequest(msg) => WireMessage::try_from(msg),
            Message::Status(msg) => WireMessage::try_from(msg),
            Message::CommInfoReply(msg) => WireMessage::try_from(msg),
            Message::CommInfoRequest(msg) => WireMessage::try_from(msg),
            Message::CommOpen(msg) => WireMessage::try_from(msg),
            Message::CommMsg(msg) => WireMessage::try_from(msg),
            Message::CommClose(msg) => WireMessage::try_from(msg),
            Message::ClientEvent(msg) => WireMessage::try_from(msg),
        }
    }
}

impl TryFrom<&WireMessage> for Message {
    type Error = crate::error::Error;

    /// Converts from a wire message to a Jupyter message by examining the message
    /// type and attempting to coerce the content into the appropriate
    /// structure.
    ///
    /// Note that not all message types are supported here; this handles only
    /// messages that are received from the front end.
    fn try_from(msg: &WireMessage) -> Result<Self, Error> {
        let kind = msg.header.msg_type.clone();
        if kind == KernelInfoRequest::message_type() {
            return Ok(Message::KernelInfoRequest(JupyterMessage::try_from(msg)?));
        } else if kind == KernelInfoReply::message_type() {
            return Ok(Message::KernelInfoReply(JupyterMessage::try_from(msg)?));
        } else if kind == IsCompleteRequest::message_type() {
            return Ok(Message::IsCompleteRequest(JupyterMessage::try_from(msg)?));
        } else if kind == IsCompleteReply::message_type() {
            return Ok(Message::IsCompleteReply(JupyterMessage::try_from(msg)?));
        } else if kind == InspectRequest::message_type() {
            return Ok(Message::InspectRequest(JupyterMessage::try_from(msg)?));
        } else if kind == InspectReply::message_type() {
            return Ok(Message::InspectReply(JupyterMessage::try_from(msg)?));
        } else if kind == ExecuteRequest::message_type() {
            return Ok(Message::ExecuteRequest(JupyterMessage::try_from(msg)?));
        } else if kind == ExecuteReply::message_type() {
            return Ok(Message::ExecuteReply(JupyterMessage::try_from(msg)?));
        } else if kind == ExecuteResult::message_type() {
            return Ok(Message::ExecuteResult(JupyterMessage::try_from(msg)?));
        } else if kind == ExecuteInput::message_type() {
            return Ok(Message::ExecuteInput(JupyterMessage::try_from(msg)?));
        } else if kind == CompleteRequest::message_type() {
            return Ok(Message::CompleteRequest(JupyterMessage::try_from(msg)?));
        } else if kind == CompleteReply::message_type() {
            return Ok(Message::CompleteReply(JupyterMessage::try_from(msg)?));
        } else if kind == ShutdownRequest::message_type() {
            return Ok(Message::ShutdownRequest(JupyterMessage::try_from(msg)?));
        } else if kind == KernelStatus::message_type() {
            return Ok(Message::Status(JupyterMessage::try_from(msg)?));
        } else if kind == CommInfoRequest::message_type() {
            return Ok(Message::CommInfoRequest(JupyterMessage::try_from(msg)?));
        } else if kind == CommInfoReply::message_type() {
            return Ok(Message::CommInfoReply(JupyterMessage::try_from(msg)?));
        } else if kind == CommOpen::message_type() {
            return Ok(Message::CommOpen(JupyterMessage::try_from(msg)?));
        } else if kind == CommMsg::message_type() {
            return Ok(Message::CommMsg(JupyterMessage::try_from(msg)?));
        } else if kind == CommClose::message_type() {
            return Ok(Message::CommClose(JupyterMessage::try_from(msg)?));
        } else if kind == InterruptRequest::message_type() {
            return Ok(Message::InterruptRequest(JupyterMessage::try_from(msg)?));
        } else if kind == InterruptReply::message_type() {
            return Ok(Message::InterruptReply(JupyterMessage::try_from(msg)?));
        } else if kind == InputReply::message_type() {
            return Ok(Message::InputReply(JupyterMessage::try_from(msg)?));
        } else if kind == InputRequest::message_type() {
            return Ok(Message::InputRequest(JupyterMessage::try_from(msg)?));
        }
        return Err(Error::UnknownMessageType(kind));
    }
}

impl Message {
    pub fn read_from_socket(socket: &Socket) -> Result<Self, Error> {
        let msg = WireMessage::read_from_socket(socket)?;
        Message::try_from(&msg)
    }

    pub fn send(&self, socket: &Socket) -> Result<(), Error> {
        let msg = WireMessage::try_from(self)?;
        msg.send(socket)?;
        Ok(())
    }
}

impl<T> JupyterMessage<T>
where
    T: ProtocolMessage,
{
    /// Sends this Jupyter message to the designated ZeroMQ socket.
    pub fn send(self, socket: &Socket) -> Result<(), Error> {
        let msg = WireMessage::try_from(&self)?;
        msg.send(socket)?;
        Ok(())
    }

    /// Create a new Jupyter message, optionally as a child (reply) to an
    /// existing message.
    pub fn create(
        content: T,
        parent: Option<JupyterHeader>,
        session: &Session,
    ) -> JupyterMessage<T> {
        JupyterMessage::<T> {
            zmq_identities: Vec::new(),
            header: JupyterHeader::create(
                T::message_type(),
                session.session_id.clone(),
                session.username.clone(),
            ),
            parent_header: parent,
            content: content,
        }
    }

    /// Create a new Jupyter message with a specific ZeroMQ identity.
    pub fn create_with_identity(
        identity: Vec<u8>,
        content: T,
        session: &Session,
    ) -> JupyterMessage<T> {
        JupyterMessage::<T> {
            zmq_identities: vec![identity],
            header: JupyterHeader::create(
                T::message_type(),
                session.session_id.clone(),
                session.username.clone(),
            ),
            parent_header: None,
            content: content,
        }
    }

    /// Sends a reply to the message; convenience method combining creating the
    /// reply and sending it.
    pub fn send_reply<R: ProtocolMessage>(&self, content: R, socket: &Socket) -> Result<(), Error> {
        let reply = self.reply_msg(content, &socket.session)?;
        reply.send(&socket)
    }

    /// Sends an error reply to the message.
    pub fn send_error<R: ProtocolMessage>(
        &self,
        exception: Exception,
        socket: &Socket,
    ) -> Result<(), Error> {
        let reply = self.error_reply::<R>(exception, &socket.session);
        reply.send(&socket)
    }

    /// Create a raw reply message to this message.
    fn reply_msg<R: ProtocolMessage>(
        &self,
        content: R,
        session: &Session,
    ) -> Result<WireMessage, Error> {
        let reply = self.create_reply(content, session);
        WireMessage::try_from(&reply)
    }

    /// Create a reply to this message with the given content.
    pub fn create_reply<R: ProtocolMessage>(
        &self,
        content: R,
        session: &Session,
    ) -> JupyterMessage<R> {
        // Note that the message we are creating needs to use the kernel session
        // (given as an argument), not the client session (which we could
        // otherwise copy from the message itself)
        JupyterMessage::<R> {
            zmq_identities: self.zmq_identities.clone(),
            header: JupyterHeader::create(
                R::message_type(),
                session.session_id.clone(),
                session.username.clone(),
            ),
            parent_header: Some(self.header.clone()),
            content: content,
        }
    }

    /// Creates an error reply to this message; used on ROUTER/DEALER sockets to
    /// indicate that an error occurred while processing a Request message.
    ///
    /// Error replies are special cases; they use the message type of a
    /// successful reply, but their content is an Exception instead.
    pub fn error_reply<R: ProtocolMessage>(
        &self,
        exception: Exception,
        session: &Session,
    ) -> JupyterMessage<ErrorReply> {
        JupyterMessage::<ErrorReply> {
            zmq_identities: self.zmq_identities.clone(),
            header: JupyterHeader::create(
                R::message_type(),
                session.session_id.clone(),
                session.username.clone(),
            ),
            parent_header: Some(self.header.clone()),
            content: ErrorReply {
                status: Status::Error,
                exception: exception,
            },
        }
    }
}

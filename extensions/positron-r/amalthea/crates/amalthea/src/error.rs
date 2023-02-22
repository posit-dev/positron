/*
 * error.rs
 *
 * Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *
 */

use crate::wire::jupyter_message::Message;
use std::fmt;
use std::sync::mpsc::SendError;

/// Type representing all errors that can occur inside the Amalthea implementation.
#[derive(Debug)]
pub enum Error {
    MissingDelimiter,
    InsufficientParts(usize, usize),
    InvalidHmac(Vec<u8>, hex::FromHexError),
    BadSignature(Vec<u8>, hmac::digest::MacError),
    Utf8Error(String, Vec<u8>, std::str::Utf8Error),
    JsonParseError(String, String, serde_json::Error),
    InvalidPart(String, serde_json::Value, serde_json::Error),
    InvalidMessage(String, serde_json::Value, serde_json::Error),
    CannotSerialize(serde_json::Error),
    UnknownMessageType(String),
    NoInstallDir,
    CreateDirFailed(std::io::Error),
    JsonSerializeSpecFailed(serde_json::Error),
    CreateSpecFailed(std::io::Error),
    WriteSpecFailed(std::io::Error),
    HmacKeyInvalid(String, crypto_common::InvalidLength),
    CreateSocketFailed(String, zmq::Error),
    SocketBindError(String, String, zmq::Error),
    SocketConnectError(String, String, zmq::Error),
    UnsupportedSocketType(zmq::SocketType),
    UnsupportedMessage(Message, String),
    SendError(String),
    ReceiveError(String),
    ZmqError(String, zmq::Error),
    CannotLockSocket(String, String),
    SysError(String, nix::Error),
    UnknownCommName(String),
    UnknownCommId(String),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            Error::MissingDelimiter => {
                write!(
                    f,
                    "ZeroMQ message did not include expected <IDS|MSG> delimiter"
                )
            }
            Error::InsufficientParts(found, expected) => {
                write!(
                    f,
                    "ZeroMQ message did not contain sufficient parts (found {}, expected {})",
                    found, expected
                )
            }
            Error::InvalidHmac(data, err) => {
                write!(
                    f,
                    "ZeroMQ message HMAC signature {:?} is not a valid hexadecimal value: {}",
                    data, err
                )
            }
            Error::BadSignature(sig, err) => {
                write!(
                    f,
                    "ZeroMQ message HMAC signature {:?} is incorrect: {}",
                    sig, err
                )
            }
            Error::Utf8Error(part, data, err) => {
                write!(
                    f,
                    "Message part '{}' was not valid UTF-8: {} (raw: {:?})",
                    part, err, data
                )
            }
            Error::JsonParseError(part, str, err) => {
                write!(
                    f,
                    "Message part '{}' is invalid JSON: {} (raw: {})",
                    part, err, str
                )
            }
            Error::InvalidPart(part, json, err) => {
                write!(
                    f,
                    "Message part '{}' does not match schema: {} (raw: {})",
                    part, err, json
                )
            }
            Error::InvalidMessage(kind, json, err) => {
                write!(f, "Invalid '{}' message: {} (raw: {})", kind, err, json)
            }
            Error::UnknownMessageType(kind) => {
                write!(f, "Unknown message type '{}'", kind)
            }
            Error::CannotSerialize(err) => {
                write!(f, "Cannot serialize message: {}", err)
            }
            Error::NoInstallDir => {
                write!(f, "No Jupyter installation directory found.")
            }
            Error::CreateDirFailed(err) => {
                write!(f, "Could not create directory: {}", err)
            }
            Error::JsonSerializeSpecFailed(err) => {
                write!(f, "Could not serialize kernel spec to JSON: {}", err)
            }
            Error::CreateSpecFailed(err) => {
                write!(f, "Could not create kernel spec file: {}", err)
            }
            Error::WriteSpecFailed(err) => {
                write!(f, "Could not write kernel spec file: {}", err)
            }
            Error::HmacKeyInvalid(str, err) => {
                write!(
                    f,
                    "The HMAC supplied signing key '{}' ({} bytes) cannot be used: {}",
                    str,
                    str.len(),
                    err
                )
            }
            Error::CreateSocketFailed(str, err) => {
                write!(f, "Could not create ZeroMQ socket '{}': {}", str, err)
            }
            Error::SocketBindError(name, endpoint, err) => {
                write!(
                    f,
                    "Could not bind to ZeroMQ socket '{}' at '{}': {}",
                    name, endpoint, err
                )
            }
            Error::SocketConnectError(name, endpoint, err) => {
                write!(
                    f,
                    "Could not connect to ZeroMQ socket '{}' at '{}': {}",
                    name, endpoint, err
                )
            }
            Error::UnsupportedSocketType(socket_type) => {
                write!(
                    f,
                    "Attempt to create unsupported ZeroMQ socket type: {:?}",
                    socket_type
                )
            }
            Error::UnsupportedMessage(msg, socket) => {
                write!(f, "Unsupported message received on '{}': {:?}", socket, msg)
            }
            Error::SendError(err) => {
                write!(f, "{}", err)
            }
            Error::ReceiveError(err) => {
                write!(f, "{}", err)
            }
            Error::ZmqError(name, err) => {
                write!(f, "ZeroMQ protocol error on {} socket: {}", name, err)
            }
            Error::CannotLockSocket(name, op) => {
                write!(f, "Cannot lock ZeroMQ socket '{}' for {}", name, op)
            }
            Error::SysError(context, err) => {
                write!(f, "{} failed: system/libc error '{}'", context, err)
            }
            Error::UnknownCommName(target) => {
                write!(f, "The comm target name '{}' is not recognized or not supported.", target)
            }
            Error::UnknownCommId(id) => {
                write!(f, "The comm id '{}' does not exist.", id)
            }
        }
    }
}

impl<T: std::fmt::Debug> From<SendError<T>> for Error {
    fn from(err: SendError<T>) -> Self {
        Self::SendError(format!("Could not send {:?} to channel.", err.0))
    }
}

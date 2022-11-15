/*
 * wire_message.rs
 *
 * Copyright (C) 2022 by Posit, PBC
 *
 */

use crate::error::Error;
use crate::socket::socket::Socket;
use crate::wire::header::JupyterHeader;
use crate::wire::jupyter_message::JupyterMessage;
use crate::wire::jupyter_message::ProtocolMessage;
use generic_array::GenericArray;
use hmac::Hmac;
use log::trace;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::json;
use serde_json::value::Value;
use sha2::Sha256;

/// This delimiter separates the ZeroMQ socket identities (IDS) from the message
/// body payload (MSG).
const MSG_DELIM: &[u8] = b"<IDS|MSG>";

/// Represents an untyped Jupyter message delivered over the wire. A WireMessage
/// can represent any kind of Jupyter message; typically its header will be
/// examined and it will be converted into a typed JupyterMessage.
#[derive(Debug, Serialize, Deserialize)]
pub struct WireMessage {
    /// The ZeroMQ identities. These store the peer identity for messages
    /// delivered request-reply style over ROUTER sockets (like the shell)
    pub zmq_identities: Vec<Vec<u8>>,

    /// The header for this message
    pub header: JupyterHeader,

    /// The header of the message from which this message originated, if any
    pub parent_header: Option<JupyterHeader>,

    /// Additional metadata, if any
    pub metadata: Value,

    /// The body (payload) of the message
    pub content: Value,
}

impl WireMessage {
    /// Read a WireMessage from a ZeroMQ socket.
    pub fn read_from_socket(socket: &Socket) -> Result<WireMessage, Error> {
        let bufs = socket.recv_multipart()?;
        Self::from_buffers(bufs, &socket.session.hmac)
    }

    /// Return the Jupyter type of the message.
    pub fn message_type(&self) -> String {
        self.header.msg_type.clone()
    }

    /// Parse a Jupyter message from an array of buffers (from a ZeroMQ message)
    pub fn from_buffers(
        mut bufs: Vec<Vec<u8>>,
        hmac_key: &Option<Hmac<Sha256>>,
    ) -> Result<WireMessage, Error> {
        let mut iter = bufs.iter();

        // Find the position of the <IDS|MSG> delimiter in the message, which
        // separates the socket identities (IDS) from the body of the message
        // (MSG).
        let pos = match iter.position(|buf| &buf[..] == MSG_DELIM) {
            Some(p) => p,
            None => return Err(Error::MissingDelimiter),
        };

        // Form a collection of the remaining parts, and remove the delimiter.
        let parts: Vec<_> = bufs.drain(pos + 1..).collect();
        bufs.pop();

        // We expect to have at least 5 parts left (the HMAC + 4 message frames)
        if parts.len() < 4 {
            return Err(Error::InsufficientParts(parts.len(), 4));
        }

        // Consume and validate the HMAC signature.
        WireMessage::validate_hmac(&parts, hmac_key)?;

        // Parse the message header
        let header_val = WireMessage::parse_buffer(String::from("header"), &parts[1])?;
        let header: JupyterHeader = match serde_json::from_value(header_val.clone()) {
            Ok(h) => h,
            Err(err) => return Err(Error::InvalidPart(String::from("header"), header_val, err)),
        };

        // Parse the parent header.
        let parent: Option<JupyterHeader> = match parts[2].len() {
            0 | 1 | 2 | 4 => {
                // If there is no meaningful content in the parent header
                // buffer, we have no parent message, which is OK per the wire
                // protocol.
                None
            }
            _ => {
                // If we do have content, ensure it parses as a header.
                let parent_val =
                    WireMessage::parse_buffer(String::from("parent header"), &parts[2])?;
                match serde_json::from_value(parent_val.clone()) {
                    Ok(h) => Some(h),
                    Err(err) => {
                        return Err(Error::InvalidPart(
                            String::from("parent header"),
                            parent_val,
                            err,
                        ))
                    }
                }
            }
        };

        Ok(Self {
            zmq_identities: bufs,
            header: header,
            parent_header: parent,
            metadata: WireMessage::parse_buffer(String::from("metadata"), &parts[3])?,
            content: WireMessage::parse_buffer(String::from("content"), &parts[4])?,
        })
    }

    /// Validates the message's HMAC signature
    fn validate_hmac(bufs: &Vec<Vec<u8>>, hmac_key: &Option<Hmac<Sha256>>) -> Result<(), Error> {
        use hmac::Mac;

        // The hmac signature is the first value
        let data = &bufs[0];

        // If we don't have a key at all, no need to validate. It is acceptable
        // (per Jupyter spec) to have an empty connection key, which indicates
        // that no HMAC signatures are to be validated.
        let key = match hmac_key {
            Some(k) => k,
            None => return Ok(()),
        };

        // Decode the hexadecimal representation of the signature
        let decoded = match hex::decode(&data) {
            Ok(decoded_bytes) => decoded_bytes,
            Err(error) => return Err(Error::InvalidHmac(data.to_vec(), error)),
        };

        // Compute the real signature according to our own key
        let mut hmac_validator = key.clone();
        let mut key = true;
        for buf in bufs {
            // Skip the key itself when computing checksum
            if key {
                key = false;
                continue;
            }
            hmac_validator.update(&buf);
        }
        // Verify the signature
        if let Err(err) = hmac_validator.verify(GenericArray::from_slice(&decoded)) {
            return Err(Error::BadSignature(decoded, err));
        }

        // Signature is valid
        Ok(())
    }

    /// Parse raw buffer data from a single part of a multipart ZeroMQ message
    /// into a JSON value.
    fn parse_buffer(desc: String, buf: &[u8]) -> Result<serde_json::Value, Error> {
        // Convert the raw byte sequence from the ZeroMQ message into UTF-8
        let str = match std::str::from_utf8(&buf) {
            Ok(s) => s,
            Err(err) => return Err(Error::Utf8Error(desc, buf.to_vec(), err)),
        };

        // Parse the UTF-8 string as JSON
        let val: serde_json::Value = match serde_json::from_str(str) {
            Ok(v) => v,
            Err(err) => return Err(Error::JsonParseError(desc, String::from(str), err)),
        };

        Ok(val)
    }

    /// Send this message to the given ZeroMQ socket.
    pub fn send(&self, socket: &Socket) -> Result<(), Error> {
        match &self.parent_header {
            Some(parent) => {
                trace!(
                    "Sending '{}' message (reply to '{}') via {} socket",
                    self.header.msg_type,
                    parent.msg_type,
                    socket.name
                );
            }
            None => {
                trace!(
                    "Sending '{}' message via {} socket",
                    self.header.msg_type,
                    socket.name
                );
            }
        }

        // Serialize JSON values into byte parts in preparation for transmission
        let mut parts: Vec<Vec<u8>> = match self.to_raw_parts() {
            Ok(v) => v,
            Err(err) => return Err(Error::CannotSerialize(err)),
        };

        // Compute HMAC signature
        let hmac = match &socket.session.hmac {
            Some(key) => {
                use hmac::Mac;
                let mut sig = key.clone();
                for part in &parts {
                    sig.update(&part);
                }
                hex::encode(sig.finalize().into_bytes().as_slice())
            }
            None => String::new(),
        };

        // Create vector to store message to be delivered; start with the socket identities, if any
        let mut msg: Vec<Vec<u8>> = self.zmq_identities.clone();

        // Add <IDS|MSG> delimiter
        msg.push(MSG_DELIM.to_vec());

        // Add HMAC signature
        msg.push(hmac.as_bytes().to_vec());

        // Add all the message parts
        msg.append(&mut parts);

        // Deliver the message!
        socket.send_multipart(&msg)?;

        // Successful delivery
        Ok(())
    }

    /// Returns a vector containing the raw parts of the message
    fn to_raw_parts(&self) -> Result<Vec<Vec<u8>>, serde_json::Error> {
        let mut parts: Vec<Vec<u8>> = Vec::new();
        parts.push(serde_json::to_vec(&self.header)?);
        parts.push(serde_json::to_vec(&self.parent_header)?);
        parts.push(serde_json::to_vec(&self.metadata)?);
        parts.push(serde_json::to_vec(&self.content)?);
        Ok(parts)
    }
}

// Conversion: WireMessage (untyped) -> JupyterMessage (typed); used on
// messages we receive over the wire to parse into the correct type.
impl<T: ProtocolMessage + DeserializeOwned> TryFrom<&WireMessage> for JupyterMessage<T> {
    type Error = crate::error::Error;
    fn try_from(msg: &WireMessage) -> Result<JupyterMessage<T>, Error> {
        let content = match serde_json::from_value(msg.content.clone()) {
            Ok(val) => val,
            Err(err) => {
                return Err(Error::InvalidMessage(
                    T::message_type(),
                    msg.content.clone(),
                    err,
                ))
            }
        };
        Ok(JupyterMessage {
            zmq_identities: msg.zmq_identities.clone(),
            header: msg.header.clone(),
            parent_header: msg.parent_header.clone(),
            content: content,
        })
    }
}

// Conversion: JupyterMessage (typed) -> WireMessage (untyped); used prior to
// sending messages to get them ready for dispatch.
impl<T: ProtocolMessage> TryFrom<&JupyterMessage<T>> for WireMessage {
    type Error = crate::error::Error;

    /// Convert a typed JupyterMessage into a WireMessage, preserving ZeroMQ
    /// socket identities.
    fn try_from(msg: &JupyterMessage<T>) -> Result<Self, Error>
    where
        T: ProtocolMessage,
    {
        let content = match serde_json::to_value(msg.content.clone()) {
            Ok(val) => val,
            Err(err) => return Err(Error::CannotSerialize(err)),
        };
        Ok(Self {
            zmq_identities: msg.zmq_identities.clone(),
            header: msg.header.clone(),
            parent_header: msg.parent_header.clone(),
            metadata: json!({}),
            content: content,
        })
    }
}

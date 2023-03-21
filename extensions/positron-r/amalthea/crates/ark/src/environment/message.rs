//
// message.rs
//
// Copyright (C) 2023 by Posit Software, PBC
//
//

use serde::Deserialize;
use serde::Serialize;

use crate::environment::variable::EnvironmentVariable;

/**
 * Enum representing the different types of messages that can be sent over the
 * Environment comm channel and their associated data. The JSON representation
 * of this enum is a JSON object with a "msg_type" field that contains the
 * message type; the remaining fields are specific to the message type.
 */
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "msg_type", rename_all = "snake_case")]
pub enum EnvironmentMessage {
    /// A message containing a full listing of environment variables. Can be
    /// triggered by the server or by the client via a 'refresh' message.
    List(EnvironmentMessageList),

    /// A message containing a list of environment variables that have been
    /// assigned and a list of environment variables that have been removed.
    Update(EnvironmentMessageUpdate),

    /// A message requesting the server to deliver a full listing of environment
    /// variables.
    Refresh,

    /// A message indicating that the server has successfully processed a client
    /// request. Used only for request messages that do not return data.
    Success,

    /// A message containing an error message.
    Error(EnvironmentMessageError),
}

/**
 * The data for the List message, which contains a full listing of environment
 * variables.
 */
#[derive(Debug, Serialize, Deserialize)]
pub struct EnvironmentMessageList {
    pub variables: Vec<EnvironmentVariable>,
}

/**
 * The data for the Update message.
 */
#[derive(Debug, Serialize, Deserialize)]
pub struct EnvironmentMessageUpdate {
    pub assigned: Vec<EnvironmentVariable>,
    pub removed: Vec<String>,
}

/**
 * The data for the Error message, which contains an error message.
 */
#[derive(Debug, Serialize, Deserialize)]
pub struct EnvironmentMessageError {
    pub message: String,
}

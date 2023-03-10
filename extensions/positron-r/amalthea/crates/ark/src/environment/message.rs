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
    List(EnvironmentMessageList),
    Refresh,
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
 * The data for the Error message, which contains an error message.
 */
#[derive(Debug, Serialize, Deserialize)]
pub struct EnvironmentMessageError {
    pub message: String,
}

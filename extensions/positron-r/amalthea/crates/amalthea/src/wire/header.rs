/*
 * header.rs
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 */

use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Represents the header of a Jupyter message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JupyterHeader {
    /// The message identifier; must be unique per message
    pub msg_id: String,

    /// Session ID; must be unique per session
    pub session: String,

    /// Username; must be unique per user
    pub username: String,

    /// Date/time when message was created (ISO 8601)
    pub date: String,

    /// Message type
    pub msg_type: String,

    /// Message protocol version
    pub version: String,
}

impl JupyterHeader {
    /// Creates a new Jupyter message header
    pub fn create(msg_type: String, session: String, username: String) -> Self {
        Self {
            msg_id: Uuid::new_v4().to_string(),
            session: session,
            username: username,
            msg_type: msg_type,
            date: Utc::now().to_rfc3339(),
            version: String::from("5.3"),
        }
    }
}

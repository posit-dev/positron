/*
 * session.rs
 *
 * Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *
 */

use crate::error::Error;
use hmac::{Hmac, Mac};
use sha2::Sha256;
use uuid::Uuid;

/// A Jupyter kernel session; unique to a process.
#[derive(Clone)]
pub struct Session {
    /// The HMAC shared key that should be used to verify and sign every message
    /// sent in the session. Optional; without it, the session is
    /// unauthenticated.
    pub hmac: Option<Hmac<Sha256>>,

    /// The user running the session.
    pub username: String,

    /// The unique session ID. This is specifically the kernel's session ID, not
    /// the client's.
    pub session_id: String,
}

impl Session {
    /// Create a new Session.
    pub fn create(key: String) -> Result<Self, Error> {
        // Derive the signing key; an empty key indicates a session that doesn't
        // authenticate messages.
        let hmac_key = match key.len() {
            0 => None,
            _ => {
                let result = match Hmac::<Sha256>::new_from_slice(key.as_bytes()) {
                    Ok(hmac) => hmac,
                    Err(err) => return Err(Error::HmacKeyInvalid(key, err)),
                };
                Some(result)
            }
        };
        Ok(Self {
            hmac: hmac_key,
            session_id: Uuid::new_v4().to_string(),
            username: String::from("kernel"),
        })
    }
}

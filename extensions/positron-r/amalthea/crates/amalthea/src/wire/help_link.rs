/*
 * help_link.rs
 *
 * Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *
 */

use serde::{Deserialize, Serialize};

/// Represents a help link in a Jupyter message
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HelpLink {
    /// The text to display for the link
    pub text: String,

    /// The location (URL) of the help link
    pub url: String,
}

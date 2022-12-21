/*
 * language_info.rs
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 */

use serde::{Deserialize, Serialize};

/// Represents information about the langauge that the kernel implements
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LanguageInfo {
    /// The name of the programming language the kernel implements
    pub name: String,

    /// The version of the language
    pub version: String,

    /// The MIME type for script files in the language
    pub mimetype: String,

    /// The file extension for script files in the language
    pub file_extension: String,

    /// Pygments lexer (for highlighting), if different than name
    pub pygments_lexer: String,

    /// Codemirror mode (for editing), if different than name
    pub codemirror_mode: String,

    /// Nbconvert exporter, if not default
    pub nbconvert_exporter: String,
}

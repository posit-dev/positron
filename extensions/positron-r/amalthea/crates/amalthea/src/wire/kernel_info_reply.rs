/*
 * kernel_info_reply.rs
 *
 * Copyright (C) 2022 by Posit, PBC
 *
 */

use crate::wire::help_link::HelpLink;
use crate::wire::jupyter_message::MessageType;
use crate::wire::jupyter_message::Status;
use crate::wire::language_info::LanguageInfo;
use serde::{Deserialize, Serialize};

/// Represents a reply to a kernel_info_request
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct KernelInfoReply {
    /// The execution status ("ok" or "error")
    pub status: Status,

    /// Version of messaging protocol
    pub protocol_version: String,

    /// Information about the language the kernel supports
    pub language_info: LanguageInfo,

    /// A startup banner
    pub banner: String,

    /// Whether debugging is supported
    pub debugger: bool,

    /// A list of help links
    pub help_links: Vec<HelpLink>,
}

impl MessageType for KernelInfoReply {
    fn message_type() -> String {
        String::from("kernel_info_reply")
    }
}

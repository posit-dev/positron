//
// logger.rs
//
// Copyright (C) 2022 by RStudio, PBC
//
//

use std::sync::Mutex;
use lazy_static::lazy_static;

use tower_lsp::Client;
use tower_lsp::lsp_types::MessageType;

#[derive(Default)]
pub(crate) struct Logger {
    messages: Vec<String>,
}

#[doc(hidden)]
pub(crate) async fn flush(client: &Client) {

    let mut messages = Vec::new();

    if let Ok(mut logger) = LOGGER.lock() {
        messages = logger.messages.clone();
        logger.messages.clear();
    }

    for message in messages {
        client.log_message(MessageType::INFO, message).await;
    }

}

#[doc(hidden)]
pub(crate) fn append(message: String) {
    if let Ok(mut logger) = LOGGER.lock() {
        logger.messages.push(message);
    }
}

macro_rules! dlog {

    ($($rest:expr),*) => {{

        use std::io::prelude::*;

        // Create line to be logged.
        let prefix = format!("{}:{}:{}:", file!(), line!(), column!());
        let suffix = format!($($rest, )*);
        let line = format!("{} {}", prefix, suffix);

        // Log with the LSP.
        crate::lsp::logger::append(line.clone());

        // Also log to file (for debugging when the LSP isn't responsive)
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .append(true)
            .open("/tmp/ark.log")
            .unwrap();

        writeln!(file, "{}", line).unwrap();

    }};

}
pub(crate) use dlog;

lazy_static! {
    static ref LOGGER : Mutex<Logger> = Mutex::new(Logger::default());
}

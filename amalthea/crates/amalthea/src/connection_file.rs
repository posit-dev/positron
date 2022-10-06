/*
 * connection_file.rs
 *
 * Copyright (C) 2022 by RStudio, PBC
 *
 */

use serde::Deserialize;
use std::error::Error;
use std::fs::File;
use std::io::BufReader;
use std::path::Path;

/// The contents of the Connection File as listed in the Jupyter specfication;
/// directly parsed from JSON.
#[derive(Deserialize, Debug)]
pub struct ConnectionFile {
    /// ZeroMQ port: Control channel (kernel interrupts)
    pub control_port: u16,

    /// ZeroMQ port: Shell channel (execution, completion)
    pub shell_port: u16,

    /// ZeroMQ port: Standard input channel (prompts)
    pub stdin_port: u16,

    /// ZeroMQ port: IOPub channel (broadcasts input/output)
    pub iopub_port: u16,

    /// ZeroMQ port: Heartbeat messages (echo)
    pub hb_port: u16,

    /// LSP port: Language Server Protocol (LSP) port (optional)
    /// This is not part of the Jupyter spec, but is used by Positron
    pub lsp_port: Option<u16>,

    /// The transport type to use for ZeroMQ; generally "tcp"
    pub transport: String,

    /// The signature scheme to use for messages; generally "hmac-sha256"
    pub signature_scheme: String,

    /// The IP address to bind to
    pub ip: String,

    /// The HMAC-256 signing key, or an empty string for an unauthenticated
    /// connection
    pub key: String,
}

impl ConnectionFile {
    /// Create a ConnectionFile by parsing the contents of a connection file.
    pub fn from_file<P: AsRef<Path>>(connection_file: P) -> Result<ConnectionFile, Box<dyn Error>> {
        let file = File::open(connection_file)?;
        let reader = BufReader::new(file);
        let control = serde_json::from_reader(reader)?;

        Ok(control)
    }

    /// Given a port, return a URI-like string that can be used to connect to
    /// the port, given the other parameters in the connection file.
    ///
    /// Example: `32` => `"tcp://127.0.0.1:32"`
    pub fn endpoint(&self, port: u16) -> String {
        format!("{}://{}:{}", self.transport, self.ip, port)
    }
}

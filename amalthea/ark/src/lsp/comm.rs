// 
// comm.rs
// 
// Copyright (C) 2022 by RStudio, PBC
// 
// 

use serde::{Deserialize, Serialize};

pub const LSP_COMM_ID: &str = "C8C5265A-028C-4A3E-BA3F-D50A28E2B8E4";

#[derive(Debug, Serialize, Deserialize)]
pub struct StartLsp {
    /// The address on which the client is listening for LSP requests.
    pub client_address: String,
}

//
// comm.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct StartLsp {
    /// The address on which the client is listening for LSP requests.
    pub client_address: String,
}

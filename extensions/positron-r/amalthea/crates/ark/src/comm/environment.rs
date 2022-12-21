//
// environment.rs
//
// Copyright (C) 2022 by Posit Software, PBC
//
//

use amalthea::comm::comm_channel::CommChannel;
use serde_json::Value;

pub struct EnvironmentInstance {
}

impl CommChannel for EnvironmentInstance {
    fn send_request(&self, data: &Value) {
        println!("EnvironmentComm::send_request - data: {:?}", data);
    }

    fn target_name(&self) -> String {
        "environment".to_string()
    }

    fn close(&self) {
        println!("EnvironmentComm::close");
    }
}



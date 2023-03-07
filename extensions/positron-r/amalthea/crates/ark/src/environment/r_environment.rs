//
// r_environment.rs
//
// Copyright (C) 2023 by Posit Software, PBC
//
//

use std::thread;

use amalthea::comm::comm_channel::CommChannelMsg;
use crossbeam::channel::unbounded;
use crossbeam::channel::Receiver;
use crossbeam::channel::Sender;
use harp::object::RObject;
use libR_sys::R_GlobalEnv;
use libR_sys::R_lsInternal;
use log::debug;
use serde_json::json;
use serde_json::Value;

pub struct REnvironment {
    pub channel_msg_tx: Sender<CommChannelMsg>,
}

impl REnvironment {
    pub fn new(frontend_msg_sender: Sender<Value>) -> Self {
        let (channel_msg_tx, channel_msg_rx) = unbounded::<CommChannelMsg>();

        // Start the execution thread and wait for requests from the front end
        thread::spawn(move || Self::execution_thread(channel_msg_rx, frontend_msg_sender));
        Self { channel_msg_tx }
    }

    pub fn execution_thread(
        channel_message_rx: Receiver<CommChannelMsg>,
        frontend_msg_sender: Sender<Value>,
    ) {
        // Perform the initial environment scan
        let env_list = unsafe { list_environment() };
        frontend_msg_sender.send(env_list).unwrap();

        // Wait for requests from the front end
        loop {
            let msg = channel_message_rx.recv().unwrap();
            debug!("Received message from front end: {:?}", msg);
        }
    }
}

unsafe fn list_environment() -> Value {
    // List symbols in the environment.
    let symbols = R_lsInternal(R_GlobalEnv, 1);

    // Convert to a vector of strings.
    let strings = match RObject::new(symbols).to::<Vec<String>>() {
        Ok(v) => v,
        Err(e) => {
            return json!({ "type": "error", "message": e.to_string() });
        },
    };

    return json!({ "type": "list", "variables": strings });
}

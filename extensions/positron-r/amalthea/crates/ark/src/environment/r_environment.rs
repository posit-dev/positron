//
// r_environment.rs
//
// Copyright (C) 2023 by Posit Software, PBC
//
//

use amalthea::comm::comm_channel::CommChannelMsg;
use crossbeam::channel::unbounded;
use crossbeam::channel::Receiver;
use crossbeam::channel::Sender;
use serde_json::Value;

pub struct REnvironment {
    pub channel_msg_tx: Sender<CommChannelMsg>,
    channel_msg_rx: Receiver<CommChannelMsg>,

    frontend_msg_sender: Sender<Value>,
}

impl REnvironment {
    pub fn new(frontend_msg_sender: Sender<Value>) -> Self {
        let (channel_msg_tx, channel_msg_rx) = unbounded::<CommChannelMsg>();
        Self {
            channel_msg_tx,
            channel_msg_rx,
            frontend_msg_sender,
        }
    }
}

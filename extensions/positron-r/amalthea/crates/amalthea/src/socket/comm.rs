/*
 * comm.rs
 *
 * Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *
 */

use crossbeam::channel::Receiver;
use crossbeam::channel::Sender;
use serde_json::Value;

use crate::comm::comm_channel::CommChannelMsg;

#[derive(Clone)]
pub struct CommSocket {
    pub comm_id: String,
    pub comm_name: String,
    pub comm_msg_rx: Receiver<Value>,
    pub comm_msg_tx: Sender<Value>,
    comm_msg_handler_tx: Option<Sender<CommChannelMsg>>,
}

impl CommSocket {
    pub fn new(comm_id: String, comm_name: String) -> Self {
        let (comm_msg_tx, comm_msg_rx) = crossbeam::channel::unbounded();
        Self {
            comm_id,
            comm_name,
            comm_msg_rx,
            comm_msg_tx,
            comm_msg_handler_tx: None,
        }
    }

    pub fn set_msg_handler(&mut self, comm_msg_handler_tx: Sender<CommChannelMsg>) {
        self.comm_msg_handler_tx = Some(comm_msg_handler_tx);
    }

    pub fn handle_msg(&self, msg: Value) {
        if let Some(comm_msg_handler_tx) = &self.comm_msg_handler_tx {
            comm_msg_handler_tx.send(CommChannelMsg::Data(msg));
        }
    }

    pub fn close(&self) {
        if let Some(comm_msg_handler_tx) = &self.comm_msg_handler_tx {
            comm_msg_handler_tx.send(CommChannelMsg::Close);
        }
    }
}

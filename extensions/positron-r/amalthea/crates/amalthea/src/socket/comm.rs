/*
 * comm.rs
 *
 * Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *
 */

use crossbeam::channel::Receiver;
use crossbeam::channel::Sender;
use log::warn;
use serde_json::Value;

use crate::comm::comm_channel::CommChannelMsg;

#[derive(Clone)]
pub struct CommSocket {
    /// The comm's unique identifier.
    pub comm_id: String,

    /// The comm's name. This is a freeform string, but it's typically a member
    /// of the Comm enum.
    pub comm_name: String,

    /// The channel receiving messages from the back end that are to be relayed
    /// to the front end (ultimately via IOPub). These messages are freeform
    /// JSON values.
    pub comm_msg_rx: Receiver<CommChannelMsg>,

    /// The other side of the channel receiving messages from the back end. This
    /// `Sender` is passed to the back end of the comm channel so that it can
    /// send messages to the front end.
    pub comm_msg_tx: Sender<CommChannelMsg>,

    /// The channel supplied by the back-end to accept messages from the front
    /// end. This is an `Option` since it is not set until the back end has been
    /// initialized.
    comm_msg_handler_tx: Option<Sender<CommChannelMsg>>,
}

/**
 * A CommSocket is a relay between the back end and the front end of a comm
 * channel. It stores the comm's metadata and handles sending and receiving
 * messages.
 */
impl CommSocket {
    /**
     * Create a new CommSocket.
     *
     * - `comm_id`: The comm's unique identifier.
     * - `comm_name`: The comm's name. This is a freeform string since comm
     *    names have no restrictions in the Jupyter protocol, but it's typically a
     *    member of the Comm enum.
     */
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

    /**
     * Set the channel to be used to deliver messages to the back end.
     *
     * - `comm_msg_handler_tx`: The `Sender` side of the channel.
     */
    pub fn set_msg_handler(&mut self, comm_msg_handler_tx: Sender<CommChannelMsg>) {
        self.comm_msg_handler_tx = Some(comm_msg_handler_tx);
    }

    /**
     * Ask the back end to handle a message from the front end.
     *
     * - `id`: The ID of the message from the front end.
     * - `msg`: The message to be handled.
     */
    pub fn handle_msg(&self, id: String, msg: Value) {
        if let Some(comm_msg_handler_tx) = &self.comm_msg_handler_tx {
            if let Err(e) = comm_msg_handler_tx.send(CommChannelMsg::Rpc(id, msg)) {
                warn!(
                    "Error sending close message for comm '{}' ({}): {}",
                    self.comm_name, self.comm_id, e
                );
            }
        } else {
            warn!(
                "No message handler for comm {} ({}); dropping: {}",
                self.comm_name, self.comm_id, msg
            )
        }
    }

    /**
     * Inform the back end that the front end has requested to close the comm.
     */
    pub fn close(&self) {
        if let Some(comm_msg_handler_tx) = &self.comm_msg_handler_tx {
            if let Err(e) = comm_msg_handler_tx.send(CommChannelMsg::Close) {
                warn!(
                    "Error sending close message for comm '{}' ({}): {}",
                    self.comm_name, self.comm_id, e
                );
            }
        } else {
            warn!(
                "No message handler for comm {} ({}); dropping close",
                self.comm_name, self.comm_id
            )
        }
    }
}

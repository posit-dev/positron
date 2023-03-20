/*
 * comm_listener.rs
 *
 * Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *
 */

use crossbeam::channel::Receiver;
use crossbeam::channel::Select;
use crossbeam::channel::Sender;
use log::info;
use log::warn;

use crate::comm::comm_channel::CommChannelMsg;
use crate::socket::comm::CommSocket;
use crate::socket::iopub::IOPubMessage;
use crate::wire::comm_msg::CommMsg;

pub enum CommChanged {
    Opened(CommSocket),
    Closed(String),
}

pub fn comm_listener(iopub_tx: Sender<IOPubMessage>, comm_changed_rx: Receiver<CommChanged>) {
    // Create a vector of the open comms
    let mut open_comms = Vec::<CommSocket>::new();
    loop {
        let mut sel = Select::new();

        // Listen for messages from each of the open comms
        for comm_socket in &open_comms {
            sel.recv(&comm_socket.comm_msg_rx);
        }

        // Add a receiver for the comm_changed channel; this is used to
        // unblock the select when a comm is added or remove so we can
        // start a new `Select` with the updated set of open comms.
        sel.recv(&comm_changed_rx);

        // Wait until a message is received (blocking call)
        let oper = sel.select();

        // Look up the index in the set of open comms
        let index = oper.index();
        if index >= open_comms.len() {
            // If the index is greater than the number of open comms,
            // then the message was received on the comm_changed channel.
            let comm_changed = oper.recv(&comm_changed_rx);
            if let Err(err) = comm_changed {
                warn!("Error receiving comm_changed message: {}", err);
                continue;
            }
            match comm_changed.unwrap() {
                // A Comm was opened; add it to the list of open comms
                CommChanged::Opened(comm_socket) => {
                    open_comms.push(comm_socket);
                    info!(
                        "Comm channel opened; there are now {} open comms",
                        open_comms.len()
                    );
                },

                // A Comm was closed; attempt to remove it from the set of open comms
                CommChanged::Closed(comm_id) => {
                    // Find the index of the comm in the vector
                    let index = open_comms
                        .iter()
                        .position(|comm_socket| comm_socket.comm_id == comm_id);

                    // If we found it, remove it.
                    if let Some(index) = index {
                        open_comms.remove(index);
                        info!(
                            "Comm channel closed; there are now {} open comms",
                            open_comms.len()
                        );
                    } else {
                        warn!(
                            "Received close message for unknown comm channel {}",
                            comm_id
                        );
                    }
                },
            }
        } else {
            // Otherwise, the message was received on one of the open comms.
            let comm_socket = &open_comms[index];
            let comm_msg = match oper.recv(&comm_socket.comm_msg_rx) {
                Ok(msg) => msg,
                Err(err) => {
                    warn!("Error receiving comm message: {}", err);
                    continue;
                },
            };

            // Amend the message with the comm's ID, convert it to an
            // IOPub message, and send it to the front end
            let msg = match comm_msg {
                CommChannelMsg::Data(data) => IOPubMessage::CommMsg(CommMsg {
                    comm_id: comm_socket.comm_id.clone(),
                    data,
                }),
                CommChannelMsg::Close => IOPubMessage::CommClose(comm_socket.comm_id.clone()),
            };

            // Deliver the message to the front end
            iopub_tx.send(msg).unwrap();
        }
    }
}

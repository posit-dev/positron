/*
 * comm_listener.rs
 *
 * Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *
 */

use std::collections::HashMap;

use crossbeam::channel::Receiver;
use crossbeam::channel::Select;
use crossbeam::channel::Sender;
use log::info;
use log::warn;

use crate::comm::comm_channel::CommChannelMsg;
use crate::socket::comm::CommSocket;
use crate::socket::iopub::IOPubMessage;
use crate::wire::comm_msg::CommMsg;
use crate::wire::header::JupyterHeader;

pub enum CommChanged {
    /// A new Comm was opened
    Opened(CommSocket),

    /// An RPC was received from the front end
    PendingRpc(JupyterHeader),

    /// A Comm was closed
    Closed(String),
}

/**
 * The comm listener is responsible for listening for messages on all of the
 * open comms, attaching appropriate metadata, and relaying them to the front
 * end. It is meant to be called on a dedicated thread, and it does not return.
 *
 * - `iopub_tx`: The channel to send messages to the front end.
 * - `comm_changed_rx`: The channel to receive messages about changes to the set
 *   (or state) of open comms.
 */
pub fn comm_listener(iopub_tx: Sender<IOPubMessage>, comm_changed_rx: Receiver<CommChanged>) {
    // Create a vector of the open comms
    let mut open_comms = Vec::<CommSocket>::new();

    // Create a map of the pending RPCs, by message ID
    let mut pending_rpcs = HashMap::<String, JupyterHeader>::new();

    loop {
        let mut sel = Select::new();

        // Listen for messages from each of the open comms
        for comm_socket in &open_comms {
            sel.recv(&comm_socket.comm_msg_rx);
        }

        // Add a receiver for the comm_changed channel; this is used to
        // unblock the select when a comm is added or removed so we can
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

                // An RPC was received; add it to the map of pending RPCs
                CommChanged::PendingRpc(header) => {
                    pending_rpcs.insert(header.msg_id.clone(), header);
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
                // The comm is emitting data to the front end without being
                // asked; this is treated like an event.
                CommChannelMsg::Data(data) => IOPubMessage::CommMsgEvent(CommMsg {
                    comm_id: comm_socket.comm_id.clone(),
                    data,
                }),

                // The comm is replying to a message from the front end; the
                // first parameter names the ID of the message to which this is
                // a reply.
                CommChannelMsg::Rpc(string, data) => {
                    // Create the payload to send to the front end
                    let payload = CommMsg {
                        comm_id: comm_socket.comm_id.clone(),
                        data,
                    };

                    // Try to find the message ID in the map of pending RPCs.
                    match pending_rpcs.remove(&string) {
                        Some(header) => {
                            // Found it; consume the pending RPC and convert the
                            // message to a reply.
                            IOPubMessage::CommMsgReply(header, payload)
                        },
                        None => {
                            // Didn't find it; log a warning and treat it like
                            // an event so that the front end still gets the
                            // data.
                            warn!(
                                "Received RPC response '{:?}' for unknown message ID {}",
                                payload, string
                            );
                            IOPubMessage::CommMsgEvent(payload)
                        },
                    }
                },
                CommChannelMsg::Close => IOPubMessage::CommClose(comm_socket.comm_id.clone()),
            };

            // Deliver the message to the front end
            iopub_tx.send(msg).unwrap();
        }
    }
}

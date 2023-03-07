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
use log::error;
use serde_json::json;
use serde_json::Value;

pub struct REnvironment {
    pub channel_msg_tx: Sender<CommChannelMsg>,
}

impl REnvironment {
    pub fn new(frontend_msg_sender: Sender<CommChannelMsg>) -> Self {
        let (channel_msg_tx, channel_msg_rx) = unbounded::<CommChannelMsg>();

        // Start the execution thread and wait for requests from the front end
        thread::spawn(move || Self::execution_thread(channel_msg_rx, frontend_msg_sender));
        Self { channel_msg_tx }
    }

    pub fn execution_thread(
        channel_message_rx: Receiver<CommChannelMsg>,
        frontend_msg_sender: Sender<CommChannelMsg>,
    ) {
        // Perform the initial environment scan and deliver to the front end
        let env_list = unsafe { list_environment() };
        frontend_msg_sender
            .send(CommChannelMsg::Data(env_list))
            .unwrap();

        let mut user_initated_close = false;

        loop {
            // Wait for requests from the front end
            let msg = match channel_message_rx.recv() {
                Ok(msg) => msg,
                Err(e) => {
                    // We failed to receive a message from the front end. This
                    // is usually not a transient issue and indicates that the
                    // channel is closed, so allowing the thread to exit is
                    // appropriate. Retrying is likely to just lead to a busy
                    // loop.
                    error!(
                        "Environment: Error receiving message from front end: {:?}",
                        e
                    );
                    break;
                },
            };

            debug!("Environment: Received message from front end: {:?}", msg);

            // Break out of the loop if the front end has closed the channel
            if msg == CommChannelMsg::Close {
                debug!("Environment: Closing down after receiving comm_close from front end.");

                // Remember that the user initiated the close so that we can
                // avoid sending a duplicate close message from the back end
                user_initated_close = true;
                break;
            }

            // Process ordinary data messages
            if let CommChannelMsg::Data(data) = msg {
                // The 'type' field is required for all messages and indicates
                // the type of data being sent.
                let msg_type = match data.get("type") {
                    Some(t) => t,
                    None => {
                        error!("Environment: Received message from front end with no 'type' field; ignoring.");
                        continue;
                    },
                };

                if let Some(msg_type) = msg_type.as_str() {
                    // Match on the type of data received.
                    match msg_type {
                        // This is a request to refresh the environment list, so
                        // perform a full environment scan and deliver to the
                        // front end
                        "refresh" => {
                            let env_list = unsafe { list_environment() };
                            frontend_msg_sender
                                .send(CommChannelMsg::Data(env_list))
                                .unwrap();
                        },
                        _ => {
                            error!("Environment: Received message from front end with unknown 'type' field; ignoring.");
                        },
                    }
                } else {
                    error!("Environment: Received message from front end with non-string 'type' field {:?}; ignoring.", msg_type);
                }
            }
        }

        if !user_initated_close {
            // Send a close message to the front end if the front end didn't
            // initiate the close
            frontend_msg_sender.send(CommChannelMsg::Close).unwrap();
        }
    }
}

unsafe fn list_environment() -> Value {
    // TODO(jmcphers): Do we need to acquire the R lock here?

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

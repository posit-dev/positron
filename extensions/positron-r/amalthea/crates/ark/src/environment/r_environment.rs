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
use harp::r_lock;
use harp::r_symbol;
use libR_sys::R_GlobalEnv;
use libR_sys::R_lsInternal;
use libR_sys::Rf_findVarInFrame;
use log::debug;
use log::error;

use crate::environment::message::EnvironmentMessage;
use crate::environment::message::EnvironmentMessageError;
use crate::environment::message::EnvironmentMessageList;
use crate::environment::variable::EnvironmentVariable;

/**
 * The R Environment handler provides the server side of Positron's Environment
 * panel, and is responsible for creating and updating the list of variables in
 * the R environment.
 */
pub struct REnvironment {
    /**
     * The channel used to send comm messages (data and state changes) to the front end.
     */
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
        Self::refresh(frontend_msg_sender.clone());

        // Flag initially set to false, but set to true if the user closes the
        // channel (i.e. the front end is closed)
        let mut user_initiated_close = false;

        // Main message processing loop; we wait here for messages from the
        // front end and loop as long as the channel is open
        loop {
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
                user_initiated_close = true;
                break;
            }

            // Process ordinary data messages
            if let CommChannelMsg::Data(data) = msg {
                let message = match serde_json::from_value::<EnvironmentMessage>(data) {
                    Ok(m) => m,
                    Err(err) => {
                        error!(
                            "Environment: Received invalid message from front end. {}",
                            err
                        );
                        continue;
                    },
                };

                // Match on the type of data received.
                match message {
                    // This is a request to refresh the environment list, so
                    // perform a full environment scan and deliver to the
                    // front end
                    EnvironmentMessage::Refresh => {
                        Self::refresh(frontend_msg_sender.clone());
                    },
                    _ => {
                        error!(
                            "Environment: Don't know how to handle message type '{:?}'",
                            message
                        );
                    },
                }
            }
        }

        if !user_initiated_close {
            // Send a close message to the front end if the front end didn't
            // initiate the close
            frontend_msg_sender.send(CommChannelMsg::Close).unwrap();
        }
    }

    /**
     * Perform a full environment scan and deliver the results to the front end.
     */
    fn refresh(frontend_msg_sender: Sender<CommChannelMsg>) {
        let env_list = list_environment();
        let data = serde_json::to_value(env_list);
        match data {
            Ok(data) => frontend_msg_sender
                .send(CommChannelMsg::Data(data))
                .unwrap(),
            Err(err) => {
                error!("Environment: Failed to serialize environment data: {}", err);
            },
        }
    }
}

/**
 * List the variables in the R global environment; returns a message that can be
 * sent to the front end, either containing the list of variables or an error
 * message.
 */
fn list_environment() -> EnvironmentMessage {
    // Acquire the R lock to ensure we have exclusive access to the R global
    // environment while we're scanning it below.
    r_lock! {

        // List symbols in the environment.
        let symbols = R_lsInternal(R_GlobalEnv, 1);

        // Convert to a vector of strings.
        let strings = match RObject::new(symbols).to::<Vec<String>>() {
            Ok(v) => v,
            Err(e) => {
                return EnvironmentMessage::Error(EnvironmentMessageError {
                    message: format!("Error listing environment: {}", e),
                });
            },
        };

        // Convert each string to an EnvironmentVariable by looking up the value in
        // the global environment. (It would be more efficient, of course, to use
        // symbol vector directly, but this code is a placeholder.)
        let variables: Vec<EnvironmentVariable> = strings
            .iter()
            .map(|s| {
                let symbol = r_symbol!(s);
                let obj = RObject::view(Rf_findVarInFrame(R_GlobalEnv, symbol));
                EnvironmentVariable::new(s, obj)
            })
            .collect();

        // Form the response message.
        EnvironmentMessage::List(EnvironmentMessageList { variables })
    }
}

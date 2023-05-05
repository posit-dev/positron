//
// r_environment.rs
//
// Copyright (C) 2023 by Posit Software, PBC
//
//
use amalthea::comm::comm_channel::CommChannelMsg;
use amalthea::socket::comm::CommSocket;
use crossbeam::channel::select;
use crossbeam::channel::unbounded;
use harp::environment::Environment;
use harp::environment::Binding;
use harp::exec::RFunction;
use harp::exec::RFunctionExt;
use harp::object::RObject;
use harp::r_lock;
use harp::utils::r_assert_type;
use harp::vector::CharacterVector;
use harp::vector::Vector;
use libR_sys::*;
use log::debug;
use log::error;
use log::warn;
use stdext::spawn;

use crate::environment::message::EnvironmentMessage;
use crate::environment::message::EnvironmentMessageClear;
use crate::environment::message::EnvironmentMessageClipboardFormat;
use crate::environment::message::EnvironmentMessageDelete;
use crate::environment::message::EnvironmentMessageDetails;
use crate::environment::message::EnvironmentMessageError;
use crate::environment::message::EnvironmentMessageFormattedVariable;
use crate::environment::message::EnvironmentMessageInspect;
use crate::environment::message::EnvironmentMessageList;
use crate::environment::message::EnvironmentMessageUpdate;
use crate::environment::variable::EnvironmentVariable;
use crate::lsp::events::EVENTS;

/**
 * The R Environment handler provides the server side of Positron's Environment
 * panel, and is responsible for creating and updating the list of variables in
 * the R environment.
 */
pub struct REnvironment {
    comm: CommSocket,
    pub env: RObject,
    current_bindings: Vec<Binding>,
    version: u64,
}

impl REnvironment {
    /**
     * Creates a new REnvironment instance.
     *
     * - `env`: An R environment to scan for variables, typically R_GlobalEnv
     * - `comm`: A channel used to send messages to the front end
     */
    pub fn start(env: RObject, comm: CommSocket) {
        // Validate that the RObject we were passed is actually an environment
        if let Err(err) = r_assert_type(env.sexp, &[ENVSXP]) {
            warn!(
                "Environment: Attempt to monitor or list non-environment object {:?} ({:?})",
                env, err
            );
        }

        // Start the execution thread and wait for requests from the front end
        spawn!("ark-environment", move || {
            let environment = Self {
                comm,
                env,
                current_bindings: vec![],
                version: 0,
            };
            environment.execution_thread();
        });
    }

    pub fn execution_thread(mut self) {
        let (prompt_signal_tx, prompt_signal_rx) = unbounded::<()>();

        // Register a handler for console prompt events
        let listen_id = EVENTS.console_prompt.listen({
            move |_| {
                log::info!("Got console prompt signal.");
                prompt_signal_tx.send(()).unwrap();
            }
        });

        // Perform the initial environment scan and deliver to the front end
        self.refresh(None);

        // Flag initially set to false, but set to true if the user closes the
        // channel (i.e. the front end is closed)
        let mut user_initiated_close = false;

        // Main message processing loop; we wait here for messages from the
        // front end and loop as long as the channel is open
        loop {
            select! {
                recv(&prompt_signal_rx) -> msg => {
                    if let Ok(()) = msg {
                        self.update(None);
                    }
                },

                recv(&self.comm.incoming_rx) -> msg => {
                    let msg = match msg {
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
                    if let CommChannelMsg::Rpc(id, data) = msg {
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
                                self.refresh(Some(id));
                            },

                            EnvironmentMessage::Clear(EnvironmentMessageClear{include_hidden_objects}) => {
                                self.clear(include_hidden_objects, Some(id));
                            },

                            EnvironmentMessage::Delete(EnvironmentMessageDelete{variables}) => {
                                self.delete(variables, Some(id));
                            },

                            EnvironmentMessage::Inspect(EnvironmentMessageInspect{path}) => {
                                self.inspect(&path, Some(id));
                            },

                            EnvironmentMessage::ClipboardFormat(EnvironmentMessageClipboardFormat{path, format}) => {
                                self.clipboard_format(&path, format, Some(id));
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
            }
        }

        EVENTS.console_prompt.remove(listen_id);

        if !user_initiated_close {
            // Send a close message to the front end if the front end didn't
            // initiate the close
            self.comm.outgoing_tx.send(CommChannelMsg::Close).unwrap();
        }
    }

    fn update_bindings(&mut self, new_bindings: Vec<Binding>) -> u64 {
        self.current_bindings = new_bindings;
        self.version = self.version + 1;

        self.version
    }

    /**
     * Perform a full environment scan and deliver the results to the front end.
     * When this message is being sent in reply to a request from the front end,
     * the request ID is passed in as an argument.
     */
    fn refresh(&mut self, request_id: Option<String>) {
        let mut variables: Vec<EnvironmentVariable> = vec![];

        r_lock! {
            self.update_bindings(self.bindings());

            for binding in &self.current_bindings {
                variables.push(EnvironmentVariable::new(binding));
            }

        }

        // TODO: Avoid serializing the full list of variables if it exceeds a
        // certain threshold
        let env_size = variables.len();
        let env_list = EnvironmentMessage::List(EnvironmentMessageList {
            variables,
            length: env_size,
            version: self.version,
        });

        self.send_message(env_list, request_id);
    }

    /**
     * Clear the environment. Uses rm(envir = <env>, list = ls(<env>, all.names = TRUE))
     */
    fn clear(&mut self, include_hidden_objects: bool, request_id: Option<String>) {
        // try to rm(<env>, list = ls(envir = <env>, all.names = TRUE)))
        let result: Result<(), harp::error::Error> = r_lock! {

            let mut list = RFunction::new("base", "ls")
                .param("envir", *self.env)
                .param("all.names", Rf_ScalarLogical(include_hidden_objects as i32))
                .call()?;

            if *self.env == R_GlobalEnv {
                list = RFunction::new("base", "setdiff")
                    .add(list)
                    .add(RObject::from(".Random.seed"))
                    .call()?;
            }

            RFunction::new("base", "rm")
                .param("list", list)
                .param("envir", *self.env)
                .call()?;

            Ok(())
        };

        if let Err(_err) = result {
            error!("Failed to clear the environment");
        }

        // and then refresh anyway
        //
        // it is possible (is it ?) that in case of an error some variables
        // were removed and some were not
        self.refresh(request_id);
    }

    /**
     * Clear the environment. Uses rm(envir = <env>, list = ls(<env>, all.names = TRUE))
     */
    fn delete(&mut self, variables: Vec<String>, request_id: Option<String>) {
        r_lock! {
            let variables : Vec<&str> = variables.iter().map(|s| s as &str).collect();

            let result = RFunction::new("base", "rm")
                .param("list", CharacterVector::create(variables).cast())
                .param("envir", *self.env)
                .call();

            if let Err(_) = result {
                error!("Failed to delete variables from the environment");
            }
        }

        // and then update
        self.update(request_id);
    }

    fn clipboard_format(&mut self, path: &Vec<String>, format: String, request_id: Option<String>){
        let clipped = r_lock! {
            EnvironmentVariable::clip(RObject::view(*self.env), &path, &format)
        };

        let msg = match clipped {
            Ok(content) => {
                EnvironmentMessage::FormattedVariable(EnvironmentMessageFormattedVariable{
                    format,
                    content
                })
            }

            Err(_) => EnvironmentMessage::Error(EnvironmentMessageError {
                message: String::from("Clipboard Format error"),
            })
        };
        self.send_message(msg, request_id);
    }

    fn inspect(&mut self, path: &Vec<String>, request_id: Option<String>) {
        let inspect = r_lock! {
            EnvironmentVariable::inspect(RObject::view(*self.env), &path)
        };
        let msg = match inspect {
            Ok(children) => {
                let length = children.len();
                EnvironmentMessage::Details(EnvironmentMessageDetails {
                    path: path.clone(),
                    children,
                    length,
                })
            },
            Err(_) => EnvironmentMessage::Error(EnvironmentMessageError {
                message: String::from("Inspection error"),
            }),
        };

        self.send_message(msg, request_id);
    }

    fn send_message(&mut self, message: EnvironmentMessage, request_id: Option<String>) {
        let data = serde_json::to_value(message);

        match data {
            Ok(data) => {
                // If we were given a request ID, send the response as an RPC;
                // otherwise, send it as an event
                let comm_msg = match request_id {
                    Some(id) => CommChannelMsg::Rpc(id, data),
                    None => CommChannelMsg::Data(data),
                };

                self.comm.outgoing_tx.send(comm_msg).unwrap()
            },
            Err(err) => {
                error!("Environment: Failed to serialize environment data: {}", err);
            },
        }
    }

    fn update(&mut self, request_id: Option<String>) {
        let mut assigned: Vec<EnvironmentVariable> = vec![];
        let mut removed: Vec<String> = vec![];

        let old_bindings = &self.current_bindings;
        let mut new_bindings = vec![];

        r_lock! {
            new_bindings = self.bindings();

            let mut old_iter = old_bindings.iter();
            let mut old_next = old_iter.next();

            let mut new_iter = new_bindings.iter();
            let mut new_next = new_iter.next();

            loop {

                match (old_next, new_next) {
                    // nothing more to do
                    (None, None) => {
                        break
                    },

                    // No more old, collect last new into added
                    (None, Some(mut new)) => {
                        loop {
                            assigned.push(
                                EnvironmentVariable::new(&new)
                            );

                            match new_iter.next() {
                                Some(x) => {
                                    new = x;
                                },
                                None => break
                            };
                        }
                        break;
                    },

                    // No more new, collect the last old into removed
                    (Some(mut old), None) => {
                        loop {
                            removed.push(old.name.to_string());

                            match old_iter.next() {
                                Some(x) => {
                                    old = x;
                                },
                                None => break
                            };
                        }

                        break;
                    },

                    (Some(old), Some(new)) => {
                        if old.name == new.name {
                            if old.value != new.value {
                                assigned.push(
                                    EnvironmentVariable::new(&new)
                                );
                            }
                            old_next = old_iter.next();
                            new_next = new_iter.next();
                        } else if old.name < new.name {
                            removed.push(old.name.to_string());
                            old_next = old_iter.next();
                        } else {
                            assigned.push(
                                EnvironmentVariable::new(&new)
                            );
                            new_next = new_iter.next();
                        }
                    }
                }
            }
        }

        if assigned.len() > 0 || removed.len() > 0 || request_id.is_some() {
            // only update the bindings (and the version)
            // if anything changed
            if assigned.len() > 0 || removed.len() > 0 {
                self.update_bindings(new_bindings);
            }

            // but the message might be sent anyway if this comes from a request
            let message = EnvironmentMessage::Update(EnvironmentMessageUpdate {
                assigned,
                removed,
                version: self.version,
            });
            self.send_message(message, request_id);
        }
    }

    fn bindings(&self) -> Vec<Binding> {
        let env = Environment::new(self.env.clone());
        let mut bindings: Vec<Binding> = env.iter().filter(|binding| {
            !binding.is_hidden()
        }).collect();

        bindings.sort_by(|a, b| {
            a.name.cmp(&b.name)
        });
        bindings
    }
}

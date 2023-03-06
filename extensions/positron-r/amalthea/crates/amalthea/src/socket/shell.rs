/*
 * shell.rs
 *
 * Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *
 */

use crate::comm::comm_channel::Comm;
use crate::comm::lsp_comm::LspComm;
use crate::comm::lsp_comm::StartLsp;
use crate::error::Error;
use crate::language::lsp_handler::LspHandler;
use crate::language::shell_handler::ShellHandler;
use crate::socket::comm::CommSocket;
use crate::socket::iopub::IOPubMessage;
use crate::socket::socket::Socket;
use crate::wire::comm_close::CommClose;
use crate::wire::comm_info_reply::CommInfoReply;
use crate::wire::comm_info_request::CommInfoRequest;
use crate::wire::comm_msg::CommMsg;
use crate::wire::comm_open::CommOpen;
use crate::wire::complete_reply::CompleteReply;
use crate::wire::complete_request::CompleteRequest;
use crate::wire::execute_request::ExecuteRequest;
use crate::wire::inspect_reply::InspectReply;
use crate::wire::inspect_request::InspectRequest;
use crate::wire::is_complete_reply::IsCompleteReply;
use crate::wire::is_complete_request::IsCompleteRequest;
use crate::wire::jupyter_message::JupyterMessage;
use crate::wire::jupyter_message::Message;
use crate::wire::jupyter_message::ProtocolMessage;
use crate::wire::jupyter_message::Status;
use crate::wire::kernel_info_reply::KernelInfoReply;
use crate::wire::kernel_info_request::KernelInfoRequest;
use crate::wire::status::ExecutionState;
use crate::wire::status::KernelStatus;
use crossbeam::channel::bounded;
use crossbeam::channel::Receiver;
use crossbeam::channel::Select;
use crossbeam::channel::Sender;
use futures::executor::block_on;
use log::info;
use log::{debug, trace, warn};
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Arc;
use std::sync::Mutex;
use std::thread;

enum CommChanged {
    Opened(CommSocket),
    Closed(String),
}

/// Wrapper for the Shell socket; receives requests for execution, etc. from the
/// front end and handles them or dispatches them to the execution thread.
pub struct Shell {
    /// The ZeroMQ Shell socket
    socket: Socket,

    /// Sends messages to the IOPub socket (owned by another thread)
    iopub_tx: Sender<IOPubMessage>,

    /// Language-provided shell handler object
    shell_handler: Arc<Mutex<dyn ShellHandler>>,

    /// Language-provided LSP handler object
    lsp_handler: Option<Arc<Mutex<dyn LspHandler>>>,

    /// Map of open comm channels (UUID to CommSocket)
    open_comms: HashMap<String, CommSocket>,

    /// Sender side of channel used to notify the listener thread that a comm
    /// channel has been opened or closed
    comm_changed_tx: Sender<CommChanged>,

    /// Receiver side of channel used to notify the listener thread that a comm
    /// channel has been opened or closed
    comm_changed_rx: Receiver<CommChanged>,
}

impl Shell {
    /// Create a new Shell socket.
    ///
    /// * `socket` - The underlying ZeroMQ Shell socket
    /// * `iopub_tx` - A channel that delivers messages to the IOPub socket
    /// * `shell_handler` - The language's shell channel handler
    /// * `lsp_handler` - The language's LSP handler, if it supports LSP
    pub fn new(
        socket: Socket,
        iopub_tx: Sender<IOPubMessage>,
        shell_handler: Arc<Mutex<dyn ShellHandler>>,
        lsp_handler: Option<Arc<Mutex<dyn LspHandler>>>,
    ) -> Self {
        // Create the pair of channels that will be used to relay messages from
        // the open comms
        let (comm_changed_tx, comm_changed_rx) = bounded(10);

        Self {
            socket,
            iopub_tx,
            shell_handler,
            lsp_handler,
            open_comms: HashMap::new(),
            comm_changed_tx,
            comm_changed_rx,
        }
    }

    /// Main loop for the Shell thread; to be invoked by the kernel.
    pub fn listen(&mut self) {
        // Start a thread to listen for messages from the comm implementations.
        // We'll amend these messages with the comm's metadata and then relay
        // them to the front end via IOPub.
        //
        // This is done in a separate thread so that the main thread can
        // continue to receive messages from the front end.
        let iopub_tx = self.iopub_tx.clone();
        let comm_changed_rx = self.comm_changed_rx.clone();
        thread::spawn(move || {
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
                    let data = match oper.recv(&comm_socket.comm_msg_rx) {
                        Ok(data) => data,
                        Err(err) => {
                            warn!("Error receiving comm message: {}", err);
                            continue;
                        },
                    };

                    // Amend the message with the comm's ID
                    let msg = CommMsg {
                        comm_id: comm_socket.comm_id.clone(),
                        data,
                    };

                    // Deliver the message to the front end
                    iopub_tx.send(IOPubMessage::CommMsg(msg)).unwrap();
                }
            }
        });

        // Begin listening for shell messages
        loop {
            trace!("Waiting for shell messages");
            // Attempt to read the next message from the ZeroMQ socket
            let message = match Message::read_from_socket(&self.socket) {
                Ok(m) => m,
                Err(err) => {
                    warn!("Could not read message from shell socket: {}", err);
                    continue;
                },
            };

            // Handle the message; any failures while handling the messages are
            // delivered to the client instead of reported up the stack, so the
            // only errors likely here are "can't deliver to client"
            if let Err(err) = self.process_message(message) {
                warn!("Could not handle shell message: {}", err);
            }
        }
    }

    /// Process a message received from the front-end, optionally dispatching
    /// messages to the IOPub or execution threads
    fn process_message(&mut self, msg: Message) -> Result<(), Error> {
        match msg {
            Message::KernelInfoRequest(req) => {
                self.handle_request(req, |h, r| self.handle_info_request(h, r))
            },
            Message::IsCompleteRequest(req) => {
                self.handle_request(req, |h, r| self.handle_is_complete_request(h, r))
            },
            Message::ExecuteRequest(req) => {
                self.handle_request(req, |h, r| self.handle_execute_request(h, r))
            },
            Message::CompleteRequest(req) => {
                self.handle_request(req, |h, r| self.handle_complete_request(h, r))
            },
            Message::CommInfoRequest(req) => {
                self.handle_request(req, |h, r| self.handle_comm_info_request(h, r))
            },
            Message::CommOpen(req) => self.handle_comm_open(req),
            Message::CommMsg(req) => self.handle_request(req, |h, r| self.handle_comm_msg(h, r)),
            Message::CommClose(req) => self.handle_comm_close(req),
            Message::InspectRequest(req) => {
                self.handle_request(req, |h, r| self.handle_inspect_request(h, r))
            },
            _ => Err(Error::UnsupportedMessage(msg, String::from("shell"))),
        }
    }

    /// Wrapper for all request handlers; emits busy, invokes the handler, then
    /// emits idle. Most frontends expect all shell messages to be wrapped in
    /// this pair of statuses.
    fn handle_request<
        T: ProtocolMessage,
        H: Fn(&mut dyn ShellHandler, JupyterMessage<T>) -> Result<(), Error>,
    >(
        &self,
        req: JupyterMessage<T>,
        handler: H,
    ) -> Result<(), Error> {
        use std::ops::DerefMut;

        // Enter the kernel-busy state in preparation for handling the message.
        if let Err(err) = self.send_state(req.clone(), ExecutionState::Busy) {
            warn!("Failed to change kernel status to busy: {}", err)
        }

        // Lock the shell handler object on this thread
        let mut shell_handler = self.shell_handler.lock().unwrap();

        // Handle the message!
        //
        // TODO: The `handler` is currently a synchronous function, but it
        // always wraps an async function. Since the only reason we block this
        // is so we can mark the kernel as no longer busy when we're done, it'd
        // be better to take an async fn `handler` here just mark kernel as idle
        // when it finishes.
        let result = handler(shell_handler.deref_mut(), req.clone());

        // Return to idle -- we always do this, even if the message generated an
        // error, since many front ends won't submit additional messages until
        // the kernel is marked idle.
        if let Err(err) = self.send_state(req, ExecutionState::Idle) {
            warn!("Failed to restore kernel status to idle: {}", err)
        }
        result
    }

    /// Sets the kernel state by sending a message on the IOPub channel.
    fn send_state<T: ProtocolMessage>(
        &self,
        parent: JupyterMessage<T>,
        state: ExecutionState,
    ) -> Result<(), Error> {
        let reply = KernelStatus {
            execution_state: state,
        };
        if let Err(err) = self
            .iopub_tx
            .send(IOPubMessage::Status(parent.header, reply))
        {
            return Err(Error::SendError(format!("{}", err)));
        }
        Ok(())
    }

    /// Handles an ExecuteRequest; dispatches the request to the execution
    /// thread and forwards the response
    fn handle_execute_request(
        &self,
        handler: &mut dyn ShellHandler,
        req: JupyterMessage<ExecuteRequest>,
    ) -> Result<(), Error> {
        debug!("Received execution request {:?}", req);
        let originator = req.zmq_identities[0].clone();
        match block_on(handler.handle_execute_request(&originator, &req.content)) {
            Ok(reply) => {
                trace!("Got execution reply, delivering to front end: {:?}", reply);
                let r = req.send_reply(reply, &self.socket);
                r
            },
            Err(err) => req.send_reply(err, &self.socket),
        }
    }

    /// Handle a request to test code for completion.
    fn handle_is_complete_request(
        &self,
        handler: &dyn ShellHandler,
        req: JupyterMessage<IsCompleteRequest>,
    ) -> Result<(), Error> {
        debug!("Received request to test code for completeness: {:?}", req);
        match block_on(handler.handle_is_complete_request(&req.content)) {
            Ok(reply) => req.send_reply(reply, &self.socket),
            Err(err) => req.send_error::<IsCompleteReply>(err, &self.socket),
        }
    }

    /// Handle a request for kernel information.
    fn handle_info_request(
        &self,
        handler: &mut dyn ShellHandler,
        req: JupyterMessage<KernelInfoRequest>,
    ) -> Result<(), Error> {
        debug!("Received shell information request: {:?}", req);
        match block_on(handler.handle_info_request(&req.content)) {
            Ok(reply) => req.send_reply(reply, &self.socket),
            Err(err) => req.send_error::<KernelInfoReply>(err, &self.socket),
        }
    }

    /// Handle a request for code completion.
    fn handle_complete_request(
        &self,
        handler: &dyn ShellHandler,
        req: JupyterMessage<CompleteRequest>,
    ) -> Result<(), Error> {
        debug!("Received request to complete code: {:?}", req);
        match block_on(handler.handle_complete_request(&req.content)) {
            Ok(reply) => req.send_reply(reply, &self.socket),
            Err(err) => req.send_error::<CompleteReply>(err, &self.socket),
        }
    }

    /// Handle a request for open comms
    fn handle_comm_info_request(
        &self,
        _handler: &dyn ShellHandler,
        req: JupyterMessage<CommInfoRequest>,
    ) -> Result<(), Error> {
        debug!("Received request for open comms: {:?}", req);

        // Convert our internal map of open comms to a JSON object
        let mut info = serde_json::Map::new();
        for (comm_id, comm) in &self.open_comms {
            info.insert(
                comm_id.clone(),
                serde_json::Value::String(comm.comm_name.clone()),
            );
        }

        // Form a reply and send it
        let reply = CommInfoReply {
            status: Status::Ok,
            comms: serde_json::Value::Object(info),
        };
        req.send_reply(reply, &self.socket)
    }

    /// Handle a request to open a comm
    fn handle_comm_open(&mut self, req: JupyterMessage<CommOpen>) -> Result<(), Error> {
        debug!("Received request to open comm: {:?}", req);

        // Look up the comm ID from the request
        let comm = match Comm::from_str(&req.content.target_name) {
            Ok(comm) => comm,
            Err(err) => {
                // If the target name is not recognized, emit a warning.
                // Consider: should we pass unrecognized target names
                // through to the handler to extend support to comm types
                // that we don't know about?
                warn!(
                    "Failed to open comm; target name '{}' is unrecognized: {}",
                    &req.content.target_name, err
                );
                return Err(Error::UnknownCommName(req.content.target_name));
            },
        };

        // Get the data parameter as a string (for error reporting)
        let data_str = serde_json::to_string(&req.content.data).map_err(|err| {
            Error::InvalidCommMessage(
                req.content.target_name.clone(),
                "unparseable".to_string(),
                err.to_string(),
            )
        })?;

        let comm_id = req.content.comm_id.clone();
        let comm_name = req.content.target_name.clone();
        let mut comm_socket = CommSocket::new(comm_id, comm_name);

        // Create a routine to send messages to the front end over the IOPub
        // channel. This routine will be passed to the comm channel so it can
        // deliver messages to the front end without having to store its own
        // internal ID or a reference to the IOPub channel.

        let comm_channel = match comm {
            // If this is the special LSP comm, start the LSP server and create
            // a comm that wraps it
            Comm::Lsp => {
                if let Some(handler) = self.lsp_handler.clone() {
                    // Parse the data parameter to a StartLsp message. This is a
                    // message from the front end that contains the information
                    // about the client side of the LSP; specifically, the
                    // address to bind to.
                    let start_lsp: StartLsp =
                        serde_json::from_value(req.content.data).map_err(|err| {
                            Error::InvalidCommMessage(
                                req.content.target_name,
                                data_str,
                                err.to_string(),
                            )
                        })?;

                    // Create the new comm wrapper channel for the LSP and start
                    // the LSP server in a separate thread
                    let lsp_comm = LspComm::new(handler, comm_socket.comm_msg_tx.clone());
                    lsp_comm.start(&start_lsp)?;
                    lsp_comm.msg_sender()
                } else {
                    // If we don't have an LSP handler, return an error
                    warn!(
                        "Client attempted to start LSP, but no LSP handler was provided by kernel."
                    );
                    return Err(Error::UnknownCommName(req.content.target_name.clone()));
                }
            },
            _ => {
                // Only the LSP comm is handled by the Amalthea kernel framework
                // itself; all other comms are passed through to the shell
                // handler.
                //
                // Lock the shell handler object on this thread.
                let handler = self.shell_handler.lock().unwrap();

                // Call the shell handler to open the comm
                match block_on(handler.handle_comm_open(comm, comm_socket.comm_msg_tx.clone())) {
                    Err(err) => {
                        // If the shell handler returns an error, send it back.
                        // This is a language evaluation error, so we can send
                        // it back in that form.
                        let errname = err.ename.clone();
                        req.send_error::<CommMsg>(err, &self.socket)?;

                        // Return an error to the caller indicating that the
                        // comm could not be opened due to the invalid open
                        // call.
                        return Err(Error::InvalidCommMessage(
                            req.content.target_name.clone(),
                            data_str,
                            errname,
                        ));
                    },
                    Ok(comm) => match comm {
                        // If the shell handler returns a comm channel, we're in good shape.
                        Some(comm) => comm,
                        // If the shell handler returns None, send an error
                        // message back to the client; this indicates that the
                        // comm type was unknown to the shell handler.
                        None => {
                            return Err(Error::UnknownCommName(req.content.target_name.clone()))
                        },
                    },
                }
            },
        };

        comm_socket.set_msg_handler(comm_channel);

        // Send a notification to the comm message listener thread that a new
        // comm has been opened
        if let Err(err) = self
            .comm_changed_tx
            .send(CommChanged::Opened(comm_socket.clone()))
        {
            warn!(
                "Failed to send '{}' comm open notification to listener thread: {}",
                comm_socket.comm_name, err
            );
        }

        // If we got this far, we have just opened a comm channel. Add it to our
        // open comms.
        match self
            .open_comms
            .insert(req.content.comm_id.clone(), comm_socket)
        {
            Some(_) => {
                // We already knew about this comm; warn and discard
                warn!("Comm {} was already open", req.content.comm_id);
                Ok(())
            },
            None => Ok(()),
        }
    }

    /// Deliver a request from the front end to a comm. Specifically, this is a
    /// request from the front end to deliver a message to a backend, often as
    /// the request side of a request/response pair.
    fn handle_comm_msg(
        &self,
        _handler: &dyn ShellHandler,
        req: JupyterMessage<CommMsg>,
    ) -> Result<(), Error> {
        debug!("Received request to send a message on a comm: {:?}", req);
        // Look for the comm in our open comms
        let comm = match self.open_comms.get(&req.content.comm_id) {
            Some(comm) => comm,
            None => {
                warn!(
                    "Received a message on an unknown comm: {}",
                    req.content.comm_id
                );
                return Err(Error::UnknownCommId(req.content.comm_id));
            },
        };
        comm.handle_msg(req.content.data);
        Ok(())
    }

    /// Handle a request to close a comm
    fn handle_comm_close(&mut self, req: JupyterMessage<CommClose>) -> Result<(), Error> {
        // Look for the comm in our open comms
        debug!("Received request to close comm: {:?}", req);
        let comm = match self.open_comms.get(&req.content.comm_id) {
            Some(comm) => comm,
            None => {
                warn!(
                    "Received a request to close unknown or already closed comm: {}",
                    req.content.comm_id
                );
                return Err(Error::UnknownCommId(req.content.comm_id));
            },
        };

        // Close the comm
        comm.close();

        // Remove the comm from the set of open comms
        self.open_comms.remove(&req.content.comm_id);

        // Send a notification to the comm message listener thread notifying it that
        // the comm has been closed
        self.comm_changed_tx
            .send(CommChanged::Closed(req.content.comm_id))
            .unwrap();

        Ok(())
    }

    /// Handle a request for code inspection
    fn handle_inspect_request(
        &self,
        handler: &dyn ShellHandler,
        req: JupyterMessage<InspectRequest>,
    ) -> Result<(), Error> {
        debug!("Received request to introspect code: {:?}", req);
        match block_on(handler.handle_inspect_request(&req.content)) {
            Ok(reply) => req.send_reply(reply, &self.socket),
            Err(err) => req.send_error::<InspectReply>(err, &self.socket),
        }
    }
}

/*
 * shell.rs
 *
 * Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *
 */

use crate::comm::comm_channel::Comm;
use crate::comm::comm_channel::CommChannel;
use crate::comm::lsp_comm::StartLsp;
use crate::error::Error;
use crate::language::lsp_handler::LspHandler;
use crate::language::shell_handler::ShellHandler;
use crate::comm::lsp_comm::LspComm;
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
use crossbeam::channel::Sender;
use futures::executor::block_on;
use log::{debug, trace, warn};
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Arc;
use std::sync::Mutex;

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

    /// Map of open comm channels (UUID to CommChannel)
    open_comms: HashMap<String, Box<dyn CommChannel>>,
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
        Self {
            socket,
            iopub_tx,
            shell_handler,
            lsp_handler,
            open_comms: HashMap::new(),
        }
    }

    /// Main loop for the Shell thread; to be invoked by the kernel.
    pub fn listen(&mut self) {
        loop {
            trace!("Waiting for shell messages");
            // Attempt to read the next message from the ZeroMQ socket
            let message = match Message::read_from_socket(&self.socket) {
                Ok(m) => m,
                Err(err) => {
                    warn!("Could not read message from shell socket: {}", err);
                    continue;
                }
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
            }
            Message::IsCompleteRequest(req) => {
                self.handle_request(req, |h, r| self.handle_is_complete_request(h, r))
            }
            Message::ExecuteRequest(req) => {
                self.handle_request(req, |h, r| self.handle_execute_request(h, r))
            }
            Message::CompleteRequest(req) => {
                self.handle_request(req, |h, r| self.handle_complete_request(h, r))
            }
            Message::CommInfoRequest(req) => {
                self.handle_request(req, |h, r| self.handle_comm_info_request(h, r))
            }
            Message::CommOpen(req) => self.handle_comm_open(req),
            Message::CommMsg(req) => self.handle_request(req, |h, r| self.handle_comm_msg(h, r)),
            Message::CommClose(req) => self.handle_comm_close(req),
            Message::InspectRequest(req) => {
                self.handle_request(req, |h, r| self.handle_inspect_request(h, r))
            }
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
            }
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
                serde_json::Value::String(comm.as_ref().target_name()),
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
    fn handle_comm_open(
        &mut self,
        req: JupyterMessage<CommOpen>,
    ) -> Result<(), Error> {
        debug!("Received request to open comm: {:?}", req);

        // Look up the comm ID from the request
        let comm = match Comm::from_str(&req.content.target_name) {
            Ok(comm) => comm,
            Err(err) => {
                // If the target name is not recognized, emit a warning.
                // Consider: should we pass unrecognized target names
                // through to the handler to extend support to comm types
                // that we don't know about?
                warn!("Failed to open comm; target name '{}' is unrecognized: {}",
                    &req.content.target_name, err);
                return Err(Error::UnknownCommName(req.content.target_name));
            }
        };

        // Get the data parameter as a string (for error reporting)
        let data_str = serde_json::to_string(&req.content.data)
            .map_err(|err| Error::InvalidCommMessage(req.content.target_name.clone(), "unparseable".to_string(), err.to_string()))?;

        let comm_channel = match comm {
            // If this is the special LSP comm, start the LSP server and create
            // a comm that wraps it
            Comm::Lsp => {
                if let Some(handler) = self.lsp_handler.clone() {
                    // Parse the data parameter to a StartLsp message. This is a
                    // message from the front end that contains the information
                    // about the client side of the LSP; specifically, the
                    // address to bind to.
                    let start_lsp: StartLsp = serde_json::from_value(req.content.data)
                        .map_err(|err| Error::InvalidCommMessage(req.content.target_name, data_str, err.to_string()))?;

                    // Create the new comm wrapper channel for the LSP and start
                    // the LSP server in a separate thread
                    let lsp_comm = LspComm::new(handler);
                    lsp_comm.start(&start_lsp)?;

                    // Return the new comm channel
                    Box::new(lsp_comm) as Box<dyn CommChannel>
                } else {
                    // If we don't have an LSP handler, return an error
                    warn!("Client attempted to start LSP, but no LSP handler was provided by kernel.");
                    return Err(Error::UnknownCommName(req.content.target_name.clone()))
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
                match block_on(handler.handle_comm_open(comm)) {
                    Err(err) => {
                        // If the shell handler returns an error, send it back.
                        // This is a language evaluation error, so we can send
                        // it back in that form.
                        let errname = err.ename.clone();
                        req.send_error::<CommMsg>(err, &self.socket)?;

                        // Return an error to the caller indicating that the
                        // comm could not be opened due to the invalid open
                        // call.
                        return Err(Error::InvalidCommMessage(req.content.target_name.clone(), data_str, errname))
                    },
                    Ok(comm) => match comm {
                        // If the shell handler returns a comm channel, we're in good shape.
                        Some(comm) => comm,
                        // If the shell handler returns None, send an error
                        // message back to the client; this indicates that the
                        // comm type was unknown to the shell handler.
                        None => {
                            return Err(Error::UnknownCommName(req.content.target_name.clone()))
                        }
                    }
                }
            }
        };

        // If we got this far, we have just opened a comm channel. Add it to our
        // open comms.
        match self.open_comms.insert(req.content.comm_id.clone(), comm_channel) {
            Some(_) => {
                // We already knew about this comm; warn and discard
                warn!("Comm {} was already open", req.content.comm_id);
                Ok(())
            },
            None => {
                Ok(())
            }
        }
    }

    /// Handle a request to send a comm message
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
                warn!("Received a message on an unknown comm: {}", req.content.comm_id);
                return Err(Error::UnknownCommId(req.content.comm_id));
            }
        };
        comm.send_request(&req.content.data);
        Ok(())
    }

    /// Handle a request to close a comm
    fn handle_comm_close(
        &mut self,
        req: JupyterMessage<CommClose>,
    ) -> Result<(), Error> {
        // Look for the comm in our open comms
        debug!("Received request to close comm: {:?}", req);
        let comm = match self.open_comms.get(&req.content.comm_id) {
            Some(comm) => comm,
            None => {
                warn!("Received a request to close unknown or already closed comm: {}", req.content.comm_id);
                return Err(Error::UnknownCommId(req.content.comm_id));
            }
        };

        // Close the comm
        comm.close();

        // Remove the comm from the set of open comms
        self.open_comms.remove(&req.content.comm_id);

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

/*
 * shell.rs
 *
 * Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *
 */

use crate::comm::comm_channel::Comm;
use crate::comm::comm_channel::CommChannelMsg;
use crate::comm::event::CommChanged;
use crate::comm::event::CommEvent;
use crate::comm::lsp_comm::LspComm;
use crate::comm::lsp_comm::StartLsp;
use crate::error::Error;
use crate::language::lsp_handler::LspHandler;
use crate::language::shell_handler::ShellHandler;
use crate::socket::comm::CommInitiator;
use crate::socket::comm::CommSocket;
use crate::socket::iopub::IOPubMessage;
use crate::socket::socket::Socket;
use crate::wire::comm_close::CommClose;
use crate::wire::comm_info_reply::CommInfoReply;
use crate::wire::comm_info_reply::CommInfoTargetName;
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
use crossbeam::channel::Receiver;
use crossbeam::channel::Sender;
use futures::executor::block_on;
use log::{debug, trace, warn};
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

    /// Set of open comm channels; vector of (comm_id, target_name)
    open_comms: Vec<(String, String)>,

    /// Channel used to deliver comm events to the comm manager
    comm_manager_tx: Sender<CommEvent>,

    /// Channel used to receive comm events from the comm manager
    comm_manager_rx: Receiver<CommChanged>,
}

impl Shell {
    /// Create a new Shell socket.
    ///
    /// * `socket` - The underlying ZeroMQ Shell socket
    /// * `iopub_tx` - A channel that delivers messages to the IOPub socket
    /// * `comm_manager_tx` - A channel that delivers messages to the comm manager thread
    /// * `comm_changed_rx` - A channel that receives messages from the comm manager thread
    /// * `shell_handler` - The language's shell channel handler
    /// * `lsp_handler` - The language's LSP handler, if it supports LSP
    pub fn new(
        socket: Socket,
        iopub_tx: Sender<IOPubMessage>,
        comm_manager_tx: Sender<CommEvent>,
        comm_changed_rx: Receiver<CommChanged>,
        shell_handler: Arc<Mutex<dyn ShellHandler>>,
        lsp_handler: Option<Arc<Mutex<dyn LspHandler>>>,
    ) -> Self {
        Self {
            socket,
            iopub_tx,
            shell_handler,
            lsp_handler,
            open_comms: Vec::new(),
            comm_manager_tx,
            comm_manager_rx: comm_changed_rx,
        }
    }

    /// Main loop for the Shell thread; to be invoked by the kernel.
    pub fn listen(&mut self) {
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

            // Process any comm changes before handling the message
            self.process_comm_changes();

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
        for (comm_id, target_name) in &self.open_comms {
            // Only include comms that match the target name, if one was specified
            if req.content.target_name.is_empty() || &req.content.target_name == target_name {
                let comm_info_target = CommInfoTargetName { target_name: target_name.clone() };
                let comm_info = serde_json::to_value(comm_info_target).unwrap();
                info.insert(
                    comm_id.clone(),
                    comm_info
                );
            }
        }

        // Form a reply and send it
        let reply = CommInfoReply {
            status: Status::Ok,
            comms: info
        };
        req.send_reply(reply, &self.socket)
    }

    /// Handle a request to open a comm
    fn handle_comm_open(&mut self, req: JupyterMessage<CommOpen>) -> Result<(), Error> {
        debug!("Received request to open comm: {:?}", req);

        // Enter the kernel-busy state in preparation for handling the message.
        if let Err(err) = self.send_state(req.clone(), ExecutionState::Busy) {
            warn!("Failed to change kernel status to busy: {}", err)
        }

        // Process the comm open request
        let result = self.open_comm(req.clone());

        // Return kernel to idle state
        if let Err(err) = self.send_state(req, ExecutionState::Idle) {
            warn!("Failed to restore kernel status to idle: {}", err)
        }

        // Return the result
        result
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

        // Enter the kernel-busy state in preparation for handling the message.
        if let Err(err) = self.send_state(req.clone(), ExecutionState::Busy) {
            warn!("Failed to change kernel status to busy: {}", err)
        }

        // Store this message as a pending RPC request so that when the comm
        // responds, we can match it up
        self.comm_manager_tx
            .send(CommEvent::PendingRpc(req.header.clone()))
            .unwrap();

        // Send the message to the comm
        let msg = CommChannelMsg::Rpc(req.header.msg_id.clone(), req.content.data.clone());
        self.comm_manager_tx
            .send(CommEvent::Message(req.content.comm_id.clone(), msg))
            .unwrap();

        // Return kernel to idle state
        if let Err(err) = self.send_state(req, ExecutionState::Idle) {
            warn!("Failed to restore kernel status to idle: {}", err)
        }
        Ok(())
    }

    /**
     * Performs the body of the comm open request; wrapped in a separate method to make
     * it easier to handle errors and return to the idle state when the request is
     * complete.
     */
    fn open_comm(&mut self, req: JupyterMessage<CommOpen>) -> Result<(), Error> {
        // Check to see whether the target name begins with "positron." This
        // prefix designates comm IDs that are known to the Positron IDE.
        let comm = match req.content.target_name.starts_with("positron.") {
            // This is a known comm ID; parse it by stripping the prefix and
            // matching against the known comm types
            true => match Comm::from_str(&req.content.target_name[9..]) {
                Ok(comm) => comm,
                Err(err) => {
                    // If the target name starts with "positron." but we don't
                    // recognize the remainder of the string, consider that name
                    // to be invalid and return an error.
                    warn!(
                        "Failed to open comm; target name '{}' is unrecognized: {}",
                        &req.content.target_name, err
                    );
                    return Err(Error::UnknownCommName(req.content.target_name));
                },
            },

            // Non-Positron comm IDs (i.e. those that don't start with
            // "positron.") are passed through to the kernel without judgment.
            // These include Jupyter comm IDs, etc.
            false => Comm::Other(req.content.target_name.clone()),
        };

        // Get the data parameter as a string (for error reporting)
        let data_str = serde_json::to_string(&req.content.data).map_err(|err| {
            Error::InvalidCommMessage(
                req.content.target_name.clone(),
                "unparseable".to_string(),
                err.to_string(),
            )
        })?;

        // Create a comm socket for this comm. The initiator is FrontEnd here
        // because we're processing a request from the front end to open a comm.
        let comm_id = req.content.comm_id.clone();
        let comm_name = req.content.target_name.clone();
        let comm_data = req.content.data.clone();
        let comm_socket = CommSocket::new(CommInitiator::FrontEnd, comm_id, comm_name.clone());

        // Create a routine to send messages to the front end over the IOPub
        // channel. This routine will be passed to the comm channel so it can
        // deliver messages to the front end without having to store its own
        // internal ID or a reference to the IOPub channel.

        let opened = match comm {
            // If this is the special LSP comm, start the LSP server and create
            // a comm that wraps it
            Comm::Lsp => {
                if let Some(handler) = self.lsp_handler.clone() {
                    // Parse the data parameter to a StartLsp message. This is a
                    // message from the front end that contains the information
                    // about the client side of the LSP; specifically, the
                    // address to bind to.
                    let start_lsp: StartLsp = serde_json::from_value(req.content.data.clone())
                        .map_err(|err| {
                            Error::InvalidCommMessage(
                                req.content.target_name.clone(),
                                data_str,
                                err.to_string(),
                            )
                        })?;

                    // Create the new comm wrapper channel for the LSP and start
                    // the LSP server in a separate thread
                    let lsp_comm = LspComm::new(handler, comm_socket.outgoing_tx.clone());
                    lsp_comm.start(&start_lsp)?;
                    true
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
                match block_on(handler.handle_comm_open(comm, comm_socket.clone())) {
                    Ok(result) => result,
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
                }
            },
        };

        if opened {
            // Send a notification to the comm message listener thread that a new
            // comm has been opened
            if let Err(err) = self
                .comm_manager_tx
                .send(CommEvent::Opened(comm_socket.clone(), comm_data))
            {
                warn!(
                    "Failed to send '{}' comm open notification to listener thread: {}",
                    comm_socket.comm_name, err
                );
            }
        } else {
            // If the comm was not opened, return an error to the caller
            return Err(Error::UnknownCommName(comm_name.clone()));
        }

        Ok(())
    }

    /// Handle a request to close a comm
    fn handle_comm_close(&mut self, req: JupyterMessage<CommClose>) -> Result<(), Error> {
        // Look for the comm in our open comms
        debug!("Received request to close comm: {:?}", req);

        // Send a notification to the comm message listener thread notifying it that
        // the comm has been closed
        self.comm_manager_tx
            .send(CommEvent::Closed(req.content.comm_id))
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

    // Process changes to open comms
    fn process_comm_changes(&mut self) {
        if let Ok(comm_changed) = self.comm_manager_rx.try_recv() {
            match comm_changed {
                // Comm was added; add it to the list of open comms
                CommChanged::Added(comm_id, target_name) => {
                    self.open_comms.push((comm_id, target_name));
                },

                // Comm was removed; remove it from the list of open comms
                CommChanged::Removed(comm_id) => {
                    self.open_comms.retain(|(id, _)| id != &comm_id);
                },
            }
        }
        // No need to log errors; `try_recv` will return an error if there are no
        // messages to receive
    }
}

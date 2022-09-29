/*
 * kernel.rs
 *
 * Copyright (C) 2022 by RStudio, PBC
 *
 */

use crate::connection_file::ConnectionFile;
use crate::error::Error;
use crate::language::control_handler::ControlHandler;
use crate::language::lsp_handler::LspHandler;
use crate::language::shell_handler::ShellHandler;
use crate::session::Session;
use crate::socket::control::Control;
use crate::socket::heartbeat::Heartbeat;
use crate::socket::iopub::IOPub;
use crate::socket::iopub::IOPubMessage;
use crate::socket::shell::Shell;
use crate::socket::socket::Socket;
use crate::socket::stdin::Stdin;
use std::sync::mpsc::{Receiver, SyncSender};
use std::sync::{Arc, Mutex};
use std::thread;
use log::warn;

/// A Kernel represents a unique Jupyter kernel session and is the host for all
/// execution and messaging threads.
pub struct Kernel {
    /// The connection metadata.
    connection: ConnectionFile,

    /// The unique session information for this kernel session.
    session: Session,
}

impl Kernel {
    /// Create a new Kernel, given a connection file from a front end.
    pub fn new(file: ConnectionFile) -> Result<Kernel, Error> {
        let key = file.key.clone();

        Ok(Self {
            connection: file,
            session: Session::create(key)?,
        })
    }

    /// Connects the Kernel to the front end
    pub fn connect(
        &self,
        shell_handler: Arc<Mutex<dyn ShellHandler>>,
        control_handler: Arc<Mutex<dyn ControlHandler>>,
        lsp_handler: Option<Arc<Mutex<dyn LspHandler>>>,
        iopub_sender: SyncSender<IOPubMessage>,
        iopub_receiver: Receiver<IOPubMessage>,
    ) -> Result<(), Error> {
        let ctx = zmq::Context::new();

        // Create the Shell ROUTER/DEALER socket and start a thread to listen
        // for client messages.
        let shell_socket = Socket::new(
            self.session.clone(),
            ctx.clone(),
            String::from("Shell"),
            zmq::ROUTER,
            None,
            self.connection.endpoint(self.connection.shell_port),
        )?;
        let shell_clone = shell_handler.clone();
        thread::spawn(move || Self::shell_thread(shell_socket, iopub_sender, shell_clone));

        // Create the IOPub PUB/SUB socket and start a thread to broadcast to
        // the client. IOPub only broadcasts messages, so it listens to other
        // threads on a Receiver<Message> instead of to the client.
        let iopub_socket = Socket::new(
            self.session.clone(),
            ctx.clone(),
            String::from("IOPub"),
            zmq::PUB,
            None,
            self.connection.endpoint(self.connection.iopub_port),
        )?;
        thread::spawn(move || Self::iopub_thread(iopub_socket, iopub_receiver));

        // Create the heartbeat socket and start a thread to listen for
        // heartbeat messages.
        let heartbeat_socket = Socket::new(
            self.session.clone(),
            ctx.clone(),
            String::from("Heartbeat"),
            zmq::REP,
            None,
            self.connection.endpoint(self.connection.hb_port),
        )?;
        thread::spawn(move || Self::heartbeat_thread(heartbeat_socket));

        // Create the stdin socket and start a thread to listen for stdin
        // messages. These are used by the kernel to request input from the
        // user, and so flow in the opposite direction to the other sockets.
        let stdin_socket = Socket::new(
            self.session.clone(),
            ctx.clone(),
            String::from("Stdin"),
            zmq::ROUTER,
            None,
            self.connection.endpoint(self.connection.stdin_port),
        )?;
        let shell_clone = shell_handler.clone();
        thread::spawn(move || Self::stdin_thread(stdin_socket, shell_clone));

        // Create the Control ROUTER/DEALER socket
        let control_socket = Socket::new(
            self.session.clone(),
            ctx.clone(),
            String::from("Control"),
            zmq::ROUTER,
            None,
            self.connection.endpoint(self.connection.control_port),
        )?;

        // If we have an LSP handler, start it
        if let Some(lsp_handler) = lsp_handler {
            if let Some(lsp_port) = self.connection.lsp_port {
                lsp_handler.lock().unwrap().start(self.connection.endpoint(lsp_port))?;
            } else {
                warn!("LSP handler supplied, but LSP port not specified in connection file. Not starting LSP server.");
            }
        }

        // TODO: thread/join thread? Exiting this thread will cause the whole
        // kernel to exit.
        Self::control_thread(control_socket, control_handler);
        Ok(())
    }

    /// Starts the control thread
    fn control_thread(socket: Socket, handler: Arc<Mutex<dyn ControlHandler>>) {
        let control = Control::new(socket, handler);
        control.listen();
    }

    /// Starts the shell thread.
    fn shell_thread(
        socket: Socket,
        iopub_sender: SyncSender<IOPubMessage>,
        shell_handler: Arc<Mutex<dyn ShellHandler>>,
    ) -> Result<(), Error> {
        let mut shell = Shell::new(socket, iopub_sender.clone(), shell_handler);
        shell.listen();
        Ok(())
    }

    /// Starts the IOPub thread.
    fn iopub_thread(socket: Socket, receiver: Receiver<IOPubMessage>) -> Result<(), Error> {
        let mut iopub = IOPub::new(socket, receiver);
        iopub.listen();
        Ok(())
    }

    /// Starts the heartbeat thread.
    fn heartbeat_thread(socket: Socket) -> Result<(), Error> {
        let heartbeat = Heartbeat::new(socket);
        heartbeat.listen();
        Ok(())
    }

    fn stdin_thread(
        socket: Socket,
        shell_handler: Arc<Mutex<dyn ShellHandler>>,
    ) -> Result<(), Error> {
        let stdin = Stdin::new(socket, shell_handler);
        stdin.listen();
        Ok(())
    }
}

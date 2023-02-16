/*
 * stdin.rs
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 */

use std::sync::Arc;
use std::sync::Mutex;

use crate::language::shell_handler::ShellHandler;
use crate::socket::socket::Socket;
use crate::wire::input_request::ShellInputRequest;
use crate::wire::jupyter_message::JupyterMessage;
use crate::wire::jupyter_message::Message;
use crossbeam::channel::bounded;
use futures::executor::block_on;
use log::{trace, warn};

pub struct Stdin {
    /// The ZeroMQ stdin socket
    socket: Socket,

    /// Language-provided shell handler object
    handler: Arc<Mutex<dyn ShellHandler>>,
}

impl Stdin {
    /// Create a new Stdin socket
    ///
    /// * `socket` - The underlying ZeroMQ socket
    /// * `handler` - The language's shell handler
    pub fn new(socket: Socket, handler: Arc<Mutex<dyn ShellHandler>>) -> Self {
        Self {
            socket: socket,
            handler: handler,
        }
    }

    /// Listens for messages on the stdin socket. This follows a simple loop:
    ///
    /// 1. Wait for
    pub fn listen(&self) {
        // Create the communication channel for the shell handler and inject it
        let (tx, rx) = bounded::<ShellInputRequest>(1);
        {
            let mut shell_handler = self.handler.lock().unwrap();
            shell_handler.establish_input_handler(tx);
        }

        // Listen for input requests from the back end
        loop {
            // Wait for a message (input request) from the back end
            let req = rx.recv().unwrap();

            // Deliver the message to the front end
            let msg = JupyterMessage::create_with_identity(
                req.originator,
                req.request,
                &self.socket.session,
            );
            if let Err(err) = msg.send(&self.socket) {
                warn!("Failed to send message to front end: {}", err);
            }
            trace!("Sent input request to front end, waiting for input reply...");

            // Attempt to read the front end's reply message from the ZeroMQ socket.
            //
            // TODO: This will block until the front end sends an input request,
            // which could be a while and perhaps never if the user cancels the
            // operation, never provides input, etc. We should probably have a
            // timeout here, or some way to cancel the read if another input
            // request arrives.
            let message = match Message::read_from_socket(&self.socket) {
                Ok(m) => m,
                Err(err) => {
                    warn!("Could not read message from stdin socket: {}", err);
                    continue;
                }
            };

            // Only input replies are expected on this socket
            let reply = match message {
                Message::InputReply(reply) => reply,
                _ => {
                    warn!("Received unexpected message on stdin socket: {:?}", message);
                    continue;
                }
            };
            trace!("Received input reply from front-end: {:?}", reply);

            // Send the reply to the shell handler
            let handler = self.handler.lock().unwrap();
            if let Err(err) = block_on(handler.handle_input_reply(&reply.content)) {
                warn!("Error handling input reply: {:?}", err);
            }
        }
    }
}

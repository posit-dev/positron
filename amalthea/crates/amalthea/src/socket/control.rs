/*
 * control.rs
 *
 * Copyright (C) 2022 by Posit, PBC
 *
 */

use crate::error::Error;
use crate::language::control_handler::ControlHandler;
use crate::socket::socket::Socket;
use crate::wire::jupyter_message::Message;
use futures::executor::block_on;
use log::{info, trace, warn};
use std::sync::{Arc, Mutex};

pub struct Control {
    socket: Socket,
    handler: Arc<Mutex<dyn ControlHandler>>,
}

impl Control {
    pub fn new(socket: Socket, handler: Arc<Mutex<dyn ControlHandler>>) -> Self {
        Self {
            socket: socket,
            handler: handler,
        }
    }

    /// Main loop for the Control thread; to be invoked by the kernel.
    pub fn listen(&self) {
        loop {
            trace!("Waiting for control messages");
            // Attempt to read the next message from the ZeroMQ socket
            let message = match Message::read_from_socket(&self.socket) {
                Ok(m) => m,
                Err(err) => {
                    warn!("Could not read message from control socket: {}", err);
                    continue;
                }
            };

            match message {
                Message::ShutdownRequest(req) => {
                    info!("Received shutdown request, shutting down kernel: {:?}", req);

                    // Lock the shell handler object on this thread
                    let shell_handler = self.handler.lock().unwrap();
                    if let Err(ex) = block_on(shell_handler.handle_shutdown_request(&req.content)) {
                        warn!("Failed to handle shutdown request: {:?}", ex);
                        // TODO: if this fails, maybe we need to force a process shutdown?
                    }
                    break;
                }
                Message::InterruptRequest(req) => {
                    info!(
                        "Received interrupt request, asking kernel to stop: {:?}",
                        req
                    );

                    let control_handler = self.handler.lock().unwrap();
                    if let Err(ex) = block_on(control_handler.handle_interrupt_request()) {
                        warn!("Failed to handle interrupt request: {:?}", ex);
                    }
                    // TODO: What happens if the interrupt isn't handled?
                }
                _ => warn!(
                    "{}",
                    Error::UnsupportedMessage(message, String::from("Control"))
                ),
            }
        }
    }
}

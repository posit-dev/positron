/*
 * heartbeat.rs
 *
 * Copyright (C) 2022 by RStudio, PBC
 *
 */

use crate::socket::socket::Socket;
use log::{debug, trace, warn};

/// Structure used for heartbeat messages
pub struct Heartbeat {
    socket: Socket,
}

impl Heartbeat {
    /// Create a new heartbeat handler from the given heartbeat socket
    pub fn new(socket: Socket) -> Self {
        Self { socket: socket }
    }

    /// Listen for heartbeats; does not return
    pub fn listen(&self) {
        loop {
            debug!("Listening for heartbeats");
            let mut msg = zmq::Message::new();
            if let Err(err) = self.socket.recv(&mut msg) {
                warn!("Error receiving heartbeat: {}", err);

                // Wait 1s before trying to receive another heartbeat. This
                // keeps us from flooding the logs when recv() isn't working.
                std::thread::sleep(std::time::Duration::from_secs(1));
                continue;
            } else {
                trace!("Heartbeat message: {:?}", msg);
            }

            // Echo the message right back!
            if let Err(err) = self.socket.send(msg) {
                warn!("Error replying to heartbeat: {}", err);
            } else {
                trace!("Heartbeat message replied");
            }
        }
    }
}

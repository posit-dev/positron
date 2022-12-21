/*
 * control.rs
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 */

use amalthea::language::control_handler::ControlHandler;
use amalthea::wire::exception::Exception;
use amalthea::wire::interrupt_reply::InterruptReply;
use amalthea::wire::jupyter_message::Status;
use amalthea::wire::shutdown_reply::ShutdownReply;
use amalthea::wire::shutdown_request::ShutdownRequest;
use async_trait::async_trait;
use log::*;
use nix::sys::signal::{self, Signal};
use nix::unistd::Pid;
use std::sync::mpsc::SyncSender;


use crate::request::Request;

pub struct Control {
    req_sender: SyncSender<Request>,
}

impl Control {
    pub fn new(sender: SyncSender<Request>) -> Self {
        Self { req_sender: sender }
    }
}

#[async_trait]
impl ControlHandler for Control {
    async fn handle_shutdown_request(
        &self,
        msg: &ShutdownRequest,
    ) -> Result<ShutdownReply, Exception> {
        debug!("Received shutdown request: {:?}", msg);
        if let Err(err) = self.req_sender.send(Request::Shutdown(msg.restart)) {
            warn!(
                "Could not deliver shutdown request to execution thread: {}",
                err
            )
        }
        Ok(ShutdownReply {
            restart: msg.restart,
        })
    }

    async fn handle_interrupt_request(&self) -> Result<InterruptReply, Exception> {
        debug!("Received interrupt request");
        signal::kill(Pid::this(), Signal::SIGINT).unwrap();
        // TODO: Windows.
        // TODO: Needs to send a SIGINT to the whole process group so that
        // processes started by R will also be interrupted.
        Ok(InterruptReply { status: Status::Ok })
    }
}

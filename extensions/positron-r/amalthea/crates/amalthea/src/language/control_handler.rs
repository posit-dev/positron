/*
 * control_handler.rs
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 */

use async_trait::async_trait;

use crate::wire::exception::Exception;
use crate::wire::interrupt_reply::InterruptReply;
use crate::wire::shutdown_reply::ShutdownReply;
use crate::wire::shutdown_request::ShutdownRequest;

#[async_trait]
pub trait ControlHandler: Send {
    /// Handles a request to shut down the kernel. This message is forwarded
    /// from the Control socket.
    ///
    /// https://jupyter-client.readthedocs.io/en/stable/messaging.html#kernel-shutdown
    async fn handle_shutdown_request(
        &self,
        msg: &ShutdownRequest,
    ) -> Result<ShutdownReply, Exception>;

    /// Handles a request to interrupt the kernel. This message is forwarded
    /// from the Control socket.
    ///
    /// https://jupyter-client.readthedocs.io/en/stable/messaging.html#kernel-interrupt
    async fn handle_interrupt_request(&self) -> Result<InterruptReply, Exception>;
}

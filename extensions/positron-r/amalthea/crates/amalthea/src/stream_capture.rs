
/*
 * stream_capture.rs
 *
 * Copyright (C) 2022 by Posit, PBC
 *
 */

use std::{sync::mpsc::SyncSender, os::unix::prelude::RawFd};
use log::{warn, trace};

use crate::{error::Error, socket::iopub::IOPubMessage, wire::stream::{Stream, StreamOutput}};

pub struct StreamCapture {
    iopub_sender: SyncSender<IOPubMessage>,
}

impl StreamCapture {
    pub fn new(
        iopub_sender: SyncSender<IOPubMessage>,
    ) -> Self {
        Self {
            iopub_sender,
        }
    }

    pub fn listen(&self) {
        if let Err(err) = Self::output_capture(self.iopub_sender.clone()) {
            warn!("Error capturing output; stdout/stderr won't be forwarded: {}", err);
        };
    }

    fn output_capture(iopub_sender: SyncSender<IOPubMessage>) -> Result<(), Error> {
        let stdout_fd = Self::redirect_fd(nix::libc::STDOUT_FILENO)?;
        let stderr_fd = Self::redirect_fd(nix::libc::STDERR_FILENO)?;
        let stdout_poll = nix::poll::PollFd::new(stdout_fd, nix::poll::PollFlags::POLLIN);
        let stderr_poll = nix::poll::PollFd::new(stderr_fd, nix::poll::PollFlags::POLLIN);
        let mut poll_fds = [stdout_poll, stderr_poll];
        loop {
            trace!("Polling for output");
            let fd = match nix::poll::poll(&mut poll_fds, 1000) {
                Ok(fd) => fd,
                Err(e) => {
                    if (e as i32) == nix::errno::Errno::EINTR as i32 {
                        break;
                    }
                    warn!("Error polling for stream data: {}", e);
                    continue;
                }
            };

            // Read from the polled file descriptor (up to 1024 bytes)
            let mut buf = [0; 1024];
            let bytes = match nix::unistd::read(fd, &mut buf) {
                Ok(bytes) => bytes,
                Err(e) => {
                    warn!("Error reading from stream (fd {}): {}", fd, e);
                    continue;
                }
            };
            trace!("Emitting stream data ({} bytes on {})", bytes, fd);

            // Coerce the file descriptor to a stream type
            let stream = match fd {
                fd if fd == stdout_fd => Stream::Stdout,
                fd if fd == stderr_fd => Stream::Stderr,
                _ => {
                    warn!("Unknown file descriptor: {}", fd);
                    continue;
                }
            };

            // Send the data to the IOPub socket
            if let Err(err) = iopub_sender.send(IOPubMessage::Stream(StreamOutput{
                stream,
                text: String::from_utf8(buf[..bytes].to_vec()).unwrap(),
            })) {
                warn!("Error sending stream data to IOPub socket: {}", err);
            };
        };
        warn!("Stream capture thread exiting after interrupt");
        Ok(())
    }


    /// Redirects a standard output stream to a pipe and returns the read end of
    /// the pipe.
    fn redirect_fd(fd: RawFd) -> Result<RawFd, Error> {
        // Create a pipe to redirect the stream to
        let (read, write) = match nix::unistd::pipe() {
            Ok((read, write)) => (read, write),
            Err(e) => {
                return Err(Error::SysError(format!("create socket for {}", fd), e));
            }
        };

        // Redirect the stream into the write end of the pipe
        if let Err(e) = nix::unistd::dup2(write, fd) {
            return Err(Error::SysError(format!("redirect stream for {}", fd), e));
        }

        // Make reads non-blocking on the read end of the pipe
        if let Err(e) = nix::fcntl::fcntl(
            read,
            nix::fcntl::FcntlArg::F_SETFL(nix::fcntl::OFlag::O_NONBLOCK)) {
            return Err(Error::SysError(format!("set non-blocking for {}", fd), e));
        }

        // Return the read end of the pipe
        return Ok(read);
    }
}
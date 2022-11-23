
/*
 * stream_capture.rs
 *
 * Copyright (C) 2022 by Posit, PBC
 *
 */

use std::{sync::mpsc::SyncSender, os::unix::prelude::{RawFd, AsRawFd}};
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
            let count = match nix::poll::poll(&mut poll_fds, 1000) {
                Ok(c) => c,
                Err(e) => {
                    if (e as i32) == nix::errno::Errno::EINTR as i32 {
                        break;
                    }
                    warn!("Error polling for stream data: {}", e);
                    continue;
                }
            };

            // No data available; likely timed out waiting for data. Try again.
            if count == 0 {
                continue;
            }

            // Loop through the poll fds and check for data.
            for poll_fd in poll_fds.iter() {
                if poll_fd.revents().unwrap().contains(nix::poll::PollFlags::POLLIN) {
                    let fd: RawFd = poll_fd.as_raw_fd();
                    let stream = if fd == stdout_fd {
                        Stream::Stdout
                    } else if fd == stderr_fd {
                        Stream::Stderr
                    } else {
                        warn!("Unknown stream fd: {}", fd);
                        continue;
                    };

                    let mut buf = [0u8; 1024];
                    let count = match nix::unistd::read(fd, &mut buf) {
                        Ok(count) => count,
                        Err(e) => {
                            warn!("Error reading stream data: {}", e);
                            continue;
                        }
                    };

                    // No data available; likely timed out waiting for data. Try again.
                    if count == 0 {
                        continue;
                    }

                    let data = String::from_utf8_lossy(&buf[..count]).to_string();
                    let output = StreamOutput{stream, text: data };
                    let message = IOPubMessage::Stream(output);
                    if let Err(e) = iopub_sender.send(message) {
                        warn!("Error sending stream data to iopub: {}", e);
                        continue;
                    }
                }
            }
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
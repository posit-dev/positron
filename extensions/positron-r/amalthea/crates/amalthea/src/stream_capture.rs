
/*
 * stream_capture.rs
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 */

use std::{sync::mpsc::SyncSender, os::unix::prelude::{RawFd, AsRawFd}};
use log::warn;

use crate::{error::Error, socket::iopub::IOPubMessage, wire::stream::{Stream, StreamOutput}};

pub struct StreamCapture {
    iopub_sender: SyncSender<IOPubMessage>,
}

/// StreamCapture captures the output of a stream and sends it to the IOPub
/// socket.
impl StreamCapture {
    pub fn new(
        iopub_sender: SyncSender<IOPubMessage>,
    ) -> Self {
        Self {
            iopub_sender,
        }
    }

    /// Listens to stdout and stderr and sends the output to the IOPub socket.
    /// Does not return.
    pub fn listen(&self) {
        if let Err(err) = Self::output_capture(self.iopub_sender.clone()) {
            warn!("Error capturing output; stdout/stderr won't be forwarded: {}", err);
        };
    }

    /// Captures stdout and stderr streams
    fn output_capture(iopub_sender: SyncSender<IOPubMessage>) -> Result<(), Error> {
        // Create redirected file descriptors for stdout and stderr. These are
        // pipes into which stdout/stderr are redirected.
        let stdout_fd = Self::redirect_fd(nix::libc::STDOUT_FILENO)?;
        let stderr_fd = Self::redirect_fd(nix::libc::STDERR_FILENO)?;

        // Create poll descriptors for both streams. These are used as
        // arguments to a poll(2) wrapper.
        let stdout_poll = nix::poll::PollFd::new(stdout_fd, nix::poll::PollFlags::POLLIN);
        let stderr_poll = nix::poll::PollFd::new(stderr_fd, nix::poll::PollFlags::POLLIN);
        let mut poll_fds = [stdout_poll, stderr_poll];

        loop {
            // Wait for data to be available on either stdout or stderr.  This
            // blocks until data is available, the streams are interrupted, or
            // the timeout occurs.
            let count = match nix::poll::poll(&mut poll_fds, 1000) {
                Ok(c) => c,
                Err(e) => {
                    // If the poll was interrupted, stop listening.
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

            // See which stream has data available.
            for poll_fd in poll_fds.iter() {

                // Skip this fd if it doesn't have any new events.
                let revents = match poll_fd.revents() {
                    Some(r) => r,
                    None => continue,
                };

                // If the stream has input (POLLIN), read it and send it to the
                // IOPub socket.
                if revents.contains(nix::poll::PollFlags::POLLIN) {
                    let fd: RawFd = poll_fd.as_raw_fd();
                    // Look up the stream name from its file descriptor.
                    let stream = if fd == stdout_fd {
                        Stream::Stdout
                    } else if fd == stderr_fd {
                        Stream::Stderr
                    } else {
                        warn!("Unknown stream fd: {}", fd);
                        continue;
                    };

                    // Read the data from the stream and send it to iopub.
                    Self::fd_to_iopub(fd, stream, iopub_sender.clone());
                }
            }
        };
        warn!("Stream capture thread exiting after interrupt");
        Ok(())
    }

    /// Reads data from a file descriptor and sends it to the IOPub socket.
    fn fd_to_iopub(fd: RawFd, stream: Stream, iopub_sender: SyncSender<IOPubMessage>) {
        // Read up to 1024 bytes from the stream into `buf`
        let mut buf = [0u8; 1024];
        let count = match nix::unistd::read(fd, &mut buf) {
            Ok(count) => count,
            Err(e) => {
                warn!("Error reading stream data: {}", e);
                return;
            }
        };

        // No bytes read? Nothing to send.
        if count == 0 {
            return;
        }

        // Convert the UTF-8 bytes to a string.
        let data = String::from_utf8_lossy(&buf[..count]).to_string();
        let output = StreamOutput{stream, text: data };

        // Create and send the IOPub
        let message = IOPubMessage::Stream(output);
        if let Err(e) = iopub_sender.send(message) {
            warn!("Error sending stream data to iopub: {}", e);
        }
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
#
# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

"""
Backport of ipykernel's shell channel wedge fix for ipykernel 7.0 to 7.3.

Those releases read the shell ROUTER socket with a ``ZMQStream`` on the shell channel
thread but send replies with a raw ``send_multipart`` on the same socket. The raw send
drains the socket's edge-triggered read edge without the stream noticing, so a request
that arrived concurrently is never read and the kernel goes silent. ipykernel 7.4.0
(ipython/ipykernel#1529) routes the reply through the stream instead; this module does
the same for the versions that still ship the raw send. See posit-dev/positron#15060.
"""

from __future__ import annotations

from threading import current_thread
from typing import TYPE_CHECKING, Any

# These modules only exist in ipykernel 7; the type check job installs the bundled 6.x.
from ipykernel.shellchannel import ShellChannelThread  # pyright: ignore[reportMissingImports]
from ipykernel.subshell_manager import SubshellManager  # pyright: ignore[reportMissingImports]
from ipykernel.thread import SHELL_CHANNEL_THREAD_NAME  # pyright: ignore[reportMissingImports]

if TYPE_CHECKING:
    import zmq
    from tornado.ioloop import IOLoop
    from zmq.eventloop.zmqstream import ZMQStream


class PositronSubshellManager(SubshellManager):
    """A subshell manager that sends shell replies through the shell ``ZMQStream``."""

    def __init__(
        self,
        context: zmq.Context[Any],
        shell_channel_io_loop: IOLoop,
        shell_socket: zmq.Socket[Any],
        thread: PositronShellChannelThread,
    ):
        super().__init__(context, shell_channel_io_loop, shell_socket)
        self._thread = thread

    def _send_on_shell_channel(self, msg) -> None:
        assert current_thread().name == SHELL_CHANNEL_THREAD_NAME
        stream = self._thread.shell_stream
        assert stream is not None, "shell_stream must be set before the kernel starts"
        stream.send_multipart(msg)


class PositronShellChannelThread(ShellChannelThread):
    """A shell channel thread whose manager sends replies through ``shell_stream``."""

    def __init__(self, context: zmq.Context[Any], shell_socket: zmq.Socket[Any], **kwargs):
        super().__init__(context, shell_socket, **kwargs)
        self._positron_context = context
        self._positron_shell_socket = shell_socket
        # Set by PositronIPKernelApp.init_kernel once the stream exists.
        self.shell_stream: ZMQStream | None = None

    @property
    def manager(self) -> SubshellManager:
        if self._manager is None:
            self._manager = PositronSubshellManager(
                self._positron_context,
                self.io_loop,
                self._positron_shell_socket,
                self,
            )
        return self._manager

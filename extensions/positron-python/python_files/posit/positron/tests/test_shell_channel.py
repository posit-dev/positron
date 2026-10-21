#
# Copyright (C) 2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

"""
Regression test for the ipykernel 7.0 to 7.3 shell channel wedge (posit-dev/positron#15060).

Adapted from ipython/ipykernel#1529's ``test_subshell_wedge.py``. A request is queued on
the shell ROUTER after its edge-triggered read edge has been consumed, then a reply is
sent through the real ``_send_on_shell_channel`` path. The stock manager strands the
request; Positron's manager routes the send through the stream, which services it.
"""

from __future__ import annotations

import contextlib
import threading
import time
from typing import Callable, cast

import pytest
import zmq
from zmq.eventloop.zmqstream import ZMQStream

from positron.positron_ipkernel import _ipykernel_sends_shell_reply_raw

pytestmark = pytest.mark.skipif(
    not _ipykernel_sends_shell_reply_raw(),
    reason="only ipykernel 7.0 to 7.3 send shell replies raw on the socket",
)

TIMEOUT = 10.0


def _run_on_loop(loop, func: Callable[[], object]) -> object:
    box: dict = {}
    done = threading.Event()

    def runner():
        try:
            box["result"] = func()
        except BaseException as exc:
            box["error"] = exc
        finally:
            done.set()

    loop.add_callback(runner)
    if not done.wait(TIMEOUT):
        raise TimeoutError("callback did not complete on the shell channel loop")
    if "error" in box:
        raise box["error"]
    return box.get("result")


def _strand_then_reply(*, stranded: bool):
    from ipykernel.shellchannel import ShellChannelThread

    from positron.shell_channel import PositronShellChannelThread

    context = zmq.Context()
    shell_socket = context.socket(zmq.ROUTER)
    port = shell_socket.bind_to_random_port("tcp://127.0.0.1")

    client = context.socket(zmq.DEALER)
    client.setsockopt(zmq.IDENTITY, b"client-1")
    client.connect(f"tcp://127.0.0.1:{port}")

    thread_class = ShellChannelThread if stranded else PositronShellChannelThread
    thread = thread_class(context, shell_socket, daemon=True)
    stream = ZMQStream(shell_socket, thread.io_loop)
    if isinstance(thread, PositronShellChannelThread):
        thread.shell_stream = stream
    thread.start()

    received: list[list[bytes]] = []
    got_message = threading.Event()

    def on_recv(frames):
        received.append(frames)
        got_message.set()

    try:
        # Like the kernel, register the handler and build the manager from the parent thread
        # while the shell channel loop is already running.
        stream.on_recv(on_recv, copy=True)
        manager = thread.manager

        client.send_multipart([b"warmup"])
        assert got_message.wait(TIMEOUT), "warmup request never delivered"
        routing_id = received[0][0]
        assert routing_id == b"client-1"
        received.clear()
        got_message.clear()

        def strand():
            client.send_multipart([b"req-1"])
            # Reading EVENTS consumes the read edge, so the request is queued but the fd is
            # no longer readable: the strand precondition.
            deadline = time.monotonic() + TIMEOUT
            while not (cast("int", shell_socket.events) & zmq.POLLIN):
                if time.monotonic() > deadline:
                    raise TimeoutError("request never queued on the ROUTER")
            assert not got_message.is_set(), "request delivered before the reply send"
            manager._send_on_shell_channel([routing_id, b"reply"])  # noqa: SLF001

        _run_on_loop(thread.io_loop, strand)

        delivered = got_message.wait(1.0 if stranded else TIMEOUT)
        return delivered, received
    finally:

        def teardown():
            with contextlib.suppress(Exception):
                thread.manager.close()
            stream.close()

        with contextlib.suppress(Exception):
            _run_on_loop(thread.io_loop, teardown)
        thread.stop()
        thread.join(timeout=TIMEOUT)
        client.close()
        shell_socket.close()
        context.term()


def test_stock_manager_strands_concurrent_request():
    delivered, received = _strand_then_reply(stranded=True)
    assert not delivered
    assert received == []


def test_positron_manager_delivers_concurrent_request():
    delivered, received = _strand_then_reply(stranded=False)
    assert delivered
    assert received[-1][-1] == b"req-1"

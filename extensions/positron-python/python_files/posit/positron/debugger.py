#
# Copyright (C) 2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

from enum import IntEnum
from pathlib import Path

from ipykernel.compiler import get_tmp_directory
from ipykernel.debugger import ROUTING_ID, Debugger
from IPython.core.getipython import get_ipython
from IPython.core.inputtransformer2 import leading_empty_lines

from .utils import get_command_uri, strip_ansi

SHOW_RUNTIME_ERROR_COMMAND = "positron-runtime-debugger.showRuntimeError"


# NOTE: This should be kept in sync with positron-runtime-debugger/src/debugAdapterErrorCode.ts.
class DebuggerErrorCode(IntEnum):
    # The language runtime failed to start the debugger.
    RuntimeFailedToStart = 0

    # The language runtime encountered an unexpected error.
    UnexpectedRuntimeError = 1


class PositronDebugger(Debugger):
    # Adapted from Debugger.start to return a more informative error message.
    def start(self):
        """Start the debugger."""
        # --- Start Positron ---
        # Initialize the error.
        error = None
        # --- End Positron ---
        if not self.debugpy_initialized:
            tmp_dir = get_tmp_directory()
            if not Path(tmp_dir).exists():
                Path(tmp_dir).mkdir(parents=True)
            host, port = self.debugpy_client.get_host_port()
            code = "import debugpy;"
            code += 'debugpy.listen(("' + host + '",' + port + "))"
            content = {"code": code, "silent": True}
            self.session.send(
                self.shell_socket,
                "execute_request",
                content,
                None,
                (self.shell_socket.getsockopt(ROUTING_ID)),
            )

            ident, msg = self.session.recv(self.shell_socket, mode=0)
            self.debugpy_initialized = msg["content"]["status"] == "ok"
            # --- Start Positron ---
            # Construct the error from the response.
            if msg["content"]["status"] == "error":
                try:
                    # Construct a command URI to show the full traceback to the user.
                    traceback = msg["content"].get("traceback", [])
                    traceback = "\n".join(traceback)
                    traceback = strip_ansi(traceback)
                    uri = get_command_uri(SHOW_RUNTIME_ERROR_COMMAND, traceback)

                    # Construct the error.
                    error = {
                        "id": DebuggerErrorCode.RuntimeFailedToStart,
                        "format": "Failed to start debugpy. Reason: {error}",
                        "variables": {
                            "error": f"{msg['content']['ename']}: {msg['content']['evalue']}"
                        },
                        "url": uri,
                        "urlLabel": "View Traceback",
                    }
                except Exception as exception:
                    # If we fail to construct the error, fall back to a generic error.
                    error = {
                        "id": DebuggerErrorCode.UnexpectedRuntimeError,
                        "format": "Unexpected error while starting debugpy. Reason: {error}",
                        "variables": {"error": str(exception)},
                    }
            # --- End Positron ---

        # Don't remove leading empty lines when debugging so the breakpoints are correctly positioned
        cleanup_transforms = get_ipython().input_transformer_manager.cleanup_transforms
        if leading_empty_lines in cleanup_transforms:
            index = cleanup_transforms.index(leading_empty_lines)
            self._removed_cleanup[index] = cleanup_transforms.pop(index)

        self.debugpy_client.connect_tcp_socket()
        # --- Start Positron ---
        # Return the error along with the initialization status.
        return self.debugpy_initialized, error
        # --- End Positron ---

    # Adapted from Debugger.process_request to include the error constructed in PositronDebugger.start.
    async def process_request(self, message):
        """Process a request."""
        reply = {}

        if message["command"] == "initialize":
            if self.is_started:
                self.log.info("The debugger has already started")
            else:
                # --- Start Positron ---
                # Unpack the error too.
                self.is_started, error = self.start()
                # --- End Positron ---
                if self.is_started:
                    self.log.info("The debugger has started")
                else:
                    reply = {
                        "command": "initialize",
                        "request_seq": message["seq"],
                        "seq": 3,
                        "success": False,
                        "type": "response",
                        # --- Start Positron ---
                        # Attach the error to the reply.
                        "body": {
                            "error": error,
                        },
                        # --- End Positron ---
                    }

        handler = self.static_debug_handlers.get(message["command"], None)
        if handler is not None:
            reply = await handler(message)
        elif self.is_started:
            handler = self.started_debug_handlers.get(message["command"], None)
            if handler is not None:
                reply = await handler(message)
            else:
                reply = await self._forward_message(message)

        if message["command"] == "disconnect":
            self.stop()
            self.breakpoint_list = {}
            self.stopped_threads = set()
            self.is_started = False
            self.log.info("The debugger has stopped")

        return reply

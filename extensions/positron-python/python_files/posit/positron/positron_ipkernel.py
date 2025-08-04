#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

"""Positron extensions to the iPython Kernel."""

from __future__ import annotations

import logging

# from pathlib import Path
# from ipykernel.compiler import get_tmp_directory
from ipykernel.debugger import Debugger

logger = logging.getLogger(__name__)


class PositronDebugger(Debugger):
    kernel = None

    # def __init__(
    #     self, log, debugpy_stream, event_callback, shell_socket, session, just_my_code=True
    # ):
    #     super().__init__(log, debugpy_stream, event_callback, shell_socket, session, just_my_code)

    # def start(self):
    #     """Start the debugger."""
    #     if not self.debugpy_initialized:
    #         tmp_dir = get_tmp_directory()
    #         if not Path(tmp_dir).exists():
    #             Path(tmp_dir).mkdir(parents=True)
    #         host, port = self.debugpy_client.get_host_port()
    #         code = "import debugpy;"
    #         code += 'debugpy.listen(("' + host + '",' + port + "));"
    #         code += "debugpy.debug_this_thread()"
    #         content = {"code": code, "silent": True}
    #         self.session.send(
    #             self.shell_socket,
    #             "execute_request",
    #             content,
    #             None,
    #             (self.shell_socket.getsockopt(ROUTING_ID)),
    #         )

    #         ident, msg = self.session.recv(self.shell_socket, mode=0)
    #         self.debugpy_initialized = msg["content"]["status"] == "ok"

    #     # Don't remove leading empty lines when debugging so the breakpoints are correctly positioned
    #     cleanup_transforms = get_ipython().input_transformer_manager.cleanup_transforms
    #     if leading_empty_lines in cleanup_transforms:
    #         index = cleanup_transforms.index(leading_empty_lines)
    #         self._removed_cleanup[index] = cleanup_transforms.pop(index)

    #     self.debugpy_client.connect_tcp_socket()
    #     return self.debugpy_initialized

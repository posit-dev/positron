#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

import contextlib
import logging
from typing import TYPE_CHECKING, Any, Dict, Optional

from comm.base_comm import BaseComm

from .positron_lsp import POSITRON

if TYPE_CHECKING:
    from .positron_ipkernel import PositronIPyKernel


logger = logging.getLogger(__name__)


class LSPService:
    """LSPService manages the positron.lsp comm and coordinates starting the LSP."""

    def __init__(self, kernel: "PositronIPyKernel"):
        self._kernel = kernel
        self._comm: Optional[BaseComm] = None

    def on_comm_open(self, comm: BaseComm, msg: Dict[str, Any]) -> None:
        """Setup positron.lsp comm to receive messages."""
        self._comm = comm

        # Register the comm message handler
        comm.on_msg(self._receive_message)

        # Parse the host and port from the comm open message
        data = msg["content"]["data"]
        ip_address = data.get("ip_address", None)
        if ip_address is None:
            logger.warning(f"No ip_address in LSP comm open message: {msg}")
            return

        # Start the language server thread
        POSITRON.start(lsp_host=ip_address, shell=self._kernel.shell, comm=comm)

    def _receive_message(self, msg: Dict[str, Any]) -> None:
        """Handle messages received from the client via the positron.lsp comm."""

    def shutdown(self) -> None:
        # Stop the language server thread
        POSITRON.stop()

        if self._comm is not None:
            with contextlib.suppress(Exception):
                self._comm.close()

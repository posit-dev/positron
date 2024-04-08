#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
#

import logging
import urllib.parse
from typing import TYPE_CHECKING, Any, Dict, Optional, Tuple

from comm.base_comm import BaseComm

from .positron_jedilsp import POSITRON

if TYPE_CHECKING:
    from .positron_ipkernel import PositronIPyKernel


logger = logging.getLogger(__name__)


class LSPService:
    """
    LSPService manages the positron.lsp comm and coordinates starting the LSP.
    """

    def __init__(self, kernel: "PositronIPyKernel"):
        self._kernel = kernel
        self._comm: Optional[BaseComm] = None

    def on_comm_open(self, comm: BaseComm, msg: Dict[str, Any]) -> None:
        """
        Setup positron.lsp comm to receive messages.
        """
        self._comm = comm

        # Register the comm message handler
        comm.on_msg(self._receive_message)

        # Parse the host and port from the comm open message
        data = msg["content"]["data"]
        client_address = data.get("client_address", None)
        if client_address is None:
            logger.warning(f"No client_address in LSP comm open message: {msg}")
            return

        host, port = self._split_address(client_address)
        if host is None or port is None:
            logger.warning(f"Could not parse host and port from client address: {client_address}")
            return

        # Start the language server thread
        POSITRON.start(lsp_host=host, lsp_port=port, shell=self._kernel.shell, comm=comm)

    def _receive_message(self, msg: Dict[str, Any]) -> None:
        """
        Handle messages received from the client via the positron.lsp comm.
        """
        pass

    def shutdown(self) -> None:
        # Stop the language server thread
        POSITRON.stop()

        if self._comm is not None:
            try:
                self._comm.close()
            except Exception:
                pass

    def _split_address(self, client_address: str) -> Tuple[Optional[str], Optional[int]]:
        """
        Split an address of the form "host:port" into a tuple of (host, port).
        """
        result = urllib.parse.urlsplit("//" + client_address)
        return (result.hostname, result.port)

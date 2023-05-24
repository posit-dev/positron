#
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
#

import urllib.parse
from typing import Optional, Tuple, TYPE_CHECKING

from .positron_jedilsp import POSITRON

if TYPE_CHECKING:
    from .positron_ipkernel import PositronIPyKernel


class LSPService:
    """
    LSPService manages the positron.lsp comm and coordinates starting the LSP.
    """

    def __init__(self, kernel: "PositronIPyKernel"):
        self.kernel = kernel
        self.lsp_comm = None

    def on_comm_open(self, comm, open_msg) -> None:
        """
        Setup positron.lsp comm to receive messages.
        """
        self.lsp_comm = comm
        comm.on_msg(self.receive_message)
        self.receive_open(open_msg)

    def receive_open(self, msg) -> None:
        """
        Start the LSP on the requested port.
        """
        data = msg["content"]["data"]

        client_address = data.get("client_address", None)
        if client_address is not None:
            host, port = self.split_address(client_address)
            if host is not None and port is not None:
                POSITRON.start(lsp_host=host, lsp_port=port, kernel=self.kernel)
                return

        raise ValueError("Invalid client_address in LSP open message")

    def receive_message(self, msg) -> None:
        """
        Handle messages received from the client via the positron.lsp comm.
        """
        pass

    def shutdown(self) -> None:
        if self.lsp_comm is not None:
            try:
                self.lsp_comm.close()
            except Exception:
                pass

    def split_address(self, client_address: str) -> Tuple[Optional[str], Optional[int]]:
        """
        Split an address of the form "host:port" into a tuple of (host, port).
        """
        result = urllib.parse.urlsplit("//" + client_address)
        return (result.hostname, result.port)

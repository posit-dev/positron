from typing import Iterable

import comm
import pytest
from IPython.conftest import get_ipython

from positron.positron_ipkernel import PositronIPyKernel


class DummyComm(comm.base_comm.BaseComm):
    """
    A comm that stores published messages for testing purposes.
    """

    def __init__(self, *args, **kwargs):
        self.messages = []
        super().__init__(*args, **kwargs)

    def publish_msg(self, msg_type, **msg):
        msg["msg_type"] = msg_type
        self.messages.append(msg)


def _create_comm(*args, **kwargs) -> DummyComm:
    return DummyComm(*args, **kwargs)


@pytest.fixture(scope="session", autouse=True)
def setup_comm() -> Iterable[None]:
    """
    Update the `comm` module to use our dummy comm.
    """
    original_create_comm = comm.create_comm
    comm.create_comm = _create_comm

    yield

    comm.create_comm = original_create_comm


@pytest.fixture(scope="session")
def kernel() -> PositronIPyKernel:
    """
    A Positron kernel for testing purposes.
    """
    shell = get_ipython()

    # Create a Positron kernel. Update shell_class to avoid a traitlets validation error,
    # since we use a TerminalInteractiveShell in tests (not a subclass of PositronShell).
    kernel = PositronIPyKernel(shell_class=shell.__class__)

    # TODO: For some reason these vars are in user_ns but not user_ns_hidden during tests. For now,
    #       manually add them to user_ns_hidden to replicate running in Positron.
    shell.user_ns_hidden.update(
        {
            k: None
            for k in [
                "__name__",
                "__doc__",
                "__package__",
                "__loader__",
                "__spec__",
                "_",
                "__",
                "___",
            ]
        }
    )

    return kernel

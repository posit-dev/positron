#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
#

from typing import Iterable
from unittest.mock import Mock

import comm
import pytest

from positron.positron_ipkernel import PositronIPyKernel, PositronShell


class DummyComm(comm.base_comm.BaseComm):
    """
    A comm that records published messages for testing purposes.
    """

    def __init__(self, *args, **kwargs):
        self.messages = []
        super().__init__(*args, **kwargs)

    def publish_msg(self, msg_type, **msg):  # type: ignore ReportIncompatibleMethodOverride
        msg["msg_type"] = msg_type
        self.messages.append(msg)


# Enable autouse so that all comms are created as DummyComms.
@pytest.fixture(autouse=True)
def patch_create_comm(monkeypatch: pytest.MonkeyPatch) -> None:
    """
    Patch the `comm.create_comm` function to use our dummy comm.
    """
    monkeypatch.setattr(comm, "create_comm", DummyComm)


# Enable autouse to ensure that the kernel is instantiated with the correct shell_class before
# anyone else tries to instantiate it.
@pytest.fixture(autouse=True)
def kernel() -> PositronIPyKernel:
    """
    The Positron kernel, configured for testing purposes.
    """
    # Create a Positron kernel. The kernel calls shell_class.instance() to get the globally
    # registered shell instance, and IPython registers a TerminalInteractiveShell instead of a
    # PositronShell. This causes a traitlets validation error unless we pass the shell_class explicitly.
    kernel = PositronIPyKernel.instance(shell_class=PositronShell)

    return kernel


# Enable autouse to ensure a clean namespace and correct user_ns_hidden in every test,
# even if it doesn't explicitly use the `shell` fixture.
@pytest.fixture(autouse=True)
def shell() -> Iterable[PositronShell]:
    shell = PositronShell.instance()

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

    yield shell

    # Reset the namespace so we don't interface with other tests (e.g. environment updates).
    shell.reset()


@pytest.fixture
def mock_dataviewer_service(shell: PositronShell, monkeypatch: pytest.MonkeyPatch) -> Mock:
    mock = Mock()
    monkeypatch.setattr(shell.kernel, "dataviewer_service", mock)
    return mock


@pytest.fixture
def mock_ui_service(shell: PositronShell, monkeypatch: pytest.MonkeyPatch) -> Mock:
    mock = Mock()
    monkeypatch.setattr(shell.kernel, "ui_service", mock)
    return mock


@pytest.fixture
def mock_help_service(shell: PositronShell, monkeypatch: pytest.MonkeyPatch) -> Mock:
    mock = Mock()
    monkeypatch.setattr(shell.kernel, "help_service", mock)
    return mock


@pytest.fixture
def mock_displayhook(shell: PositronShell, monkeypatch: pytest.MonkeyPatch) -> Mock:
    mock = Mock()
    monkeypatch.setattr(shell, "displayhook", mock)
    return mock

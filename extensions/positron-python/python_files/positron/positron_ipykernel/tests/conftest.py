#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
#

import logging
from typing import Any, Dict, Iterable, Optional, Union
from unittest.mock import MagicMock, Mock

import comm
import pytest
from jupyter_client.session import Session
from traitlets.config import Config

from positron_ipykernel.connections import ConnectionsService
from positron_ipykernel.data_explorer import DataExplorerService
from positron_ipykernel.positron_ipkernel import (
    PositronIPKernelApp,
    PositronIPyKernel,
    PositronShell,
)
from positron_ipykernel.session_mode import SessionMode
from positron_ipykernel.variables import VariablesService

logger = logging.getLogger(__name__)


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

    def pop_messages(self):
        messages = list(self.messages)
        self.messages.clear()
        return messages


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
    # Mock the application object. We haven't needed to use it in tests yet, but we do need it to
    # pass our custom attributes down to the shell.
    app = MagicMock(PositronIPKernelApp)
    app.config = Config()  # Needed to avoid traitlets errors

    # Positron-specific attributes:
    app.session_mode = SessionMode.CONSOLE

    kernel = PositronIPyKernel.instance(parent=app)

    return kernel


class TestSession(Session):
    """
    A session that logs error messages, otherwise they fail silently during tests.
    """

    def send(
        self,
        stream,
        msg_or_type: Union[Dict[str, Any], str],
        content: Optional[Dict[str, Any]] = None,
        *args,
        **kwargs,
    ) -> None:
        try:
            if msg_or_type == "error" and content is not None:
                traceback = "\n".join([content["evalue"]] + content["traceback"])
                logger.error(f"Error while executing cell: {content['ename']}: {traceback}")
        except Exception:
            # If we don't catch this, errors will be silently caught in IPython.
            logger.error("Error while sending message")


# Enable autouse to ensure a clean namespace and correct user_ns_hidden in every test,
# even if it doesn't explicitly use the `shell` fixture.
@pytest.fixture(autouse=True)
def shell() -> Iterable[PositronShell]:
    shell = PositronShell.instance()

    shell.displayhook.session = TestSession()  # type: ignore

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
def mock_connections_service(shell: PositronShell, monkeypatch: pytest.MonkeyPatch) -> Mock:
    mock = Mock()
    monkeypatch.setattr(shell.kernel, "connections_service", mock)
    return mock


@pytest.fixture
def mock_dataexplorer_service(shell: PositronShell, monkeypatch: pytest.MonkeyPatch) -> Mock:
    mock = Mock()
    monkeypatch.setattr(shell.kernel, "data_explorer_service", mock)
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


@pytest.fixture
def variables_service(kernel: PositronIPyKernel) -> VariablesService:
    """
    The Positron variables service.
    """
    return kernel.variables_service


@pytest.fixture
def variables_comm(variables_service: VariablesService) -> DummyComm:
    """
    Convenience fixture for accessing the variables comm.
    """
    # Open a comm
    variables_comm = DummyComm("dummy_variables_comm")
    variables_service.on_comm_open(variables_comm, {})

    # Clear messages due to the comm_open
    variables_comm.messages.clear()

    return variables_comm


@pytest.fixture()
def de_service(kernel: PositronIPyKernel) -> DataExplorerService:
    """
    The Positron dataviewer service.
    """
    return kernel.data_explorer_service


@pytest.fixture()
def connections_service(kernel: PositronIPyKernel) -> ConnectionsService:
    """
    The Positron connections service.
    """
    return kernel.connections_service

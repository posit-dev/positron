#
# Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

from http.server import HTTPServer
from typing import Iterable
from unittest.mock import MagicMock, Mock

import comm
import pytest
from jupyter_client.session import Session
from traitlets.config import Config

import positron.utils as utils
from positron.connections import ConnectionsService
from positron.kernel.ipkernel import PositronIPythonKernel
from positron.kernel.kernelapp import PositronIPKernelApp
from positron.kernel.session_mode import SessionMode
from positron.kernel.shell import PositronShell
from positron.variables import VariablesService

utils.TESTING = True


class DummyComm(comm.base_comm.BaseComm):
    """A comm that records published messages for testing purposes."""

    def __init__(self, *args, **kwargs):
        self.messages = []
        super().__init__(*args, **kwargs)

    def publish_msg(self, msg_type, **msg):  # type: ignore ReportIncompatibleMethodOverride
        msg["msg_type"] = msg_type
        self.messages.append(msg)

    def handle_msg(self, msg, *, raise_errors=True):
        message_count = len(self.messages)

        super().handle_msg(msg)

        # Raise JSON RPC error responses as test failures.
        if raise_errors:
            new_messages = self.messages[message_count:]
            for message in new_messages:
                error = message.get("data", {}).get("error")
                if error is not None:
                    raise AssertionError(error["message"])


class MockSession(Session):
    """A session that records sent messages for testing purposes."""

    def __init__(self, *args, **kwargs):
        self.messages = []
        super().__init__(*args, **kwargs)

    def send(self, *args, **kwargs):
        msg = super().send(*args, **kwargs)
        self.messages.append(msg)
        return msg


# Enable autouse so that all comms are created as DummyComms.
@pytest.fixture(autouse=True)
def patch_create_comm(monkeypatch: pytest.MonkeyPatch) -> None:
    """Patch the `comm.create_comm` function to use our dummy comm."""
    monkeypatch.setattr(comm, "create_comm", DummyComm)


def _prepare_shell(shell: PositronShell) -> None:
    # TODO: For some reason these vars are in user_ns but not user_ns_hidden during tests. For now,
    #       manually add them to user_ns_hidden to replicate running in Positron.
    shell.user_ns_hidden.update(
        dict.fromkeys(
            ["__name__", "__doc__", "__package__", "__loader__", "__spec__", "_", "__", "___"], ""
        )
    )


@pytest.fixture
def kernel() -> PositronIPythonKernel:
    """The Positron kernel, configured for testing purposes."""
    # Mock the application object. We haven't needed to use it in tests yet, but we do need it to
    # pass our custom attributes down to the shell.
    app = MagicMock(PositronIPKernelApp)
    app.config = Config()  # Needed to avoid traitlets errors

    # Positron-specific attributes:
    app.session_mode = SessionMode.CONSOLE

    # Use a test session to capture sent messages.
    session = MockSession()

    try:
        kernel = PositronIPythonKernel.instance(parent=app, session=session)
    except Exception:
        print(
            "Error instantiating PositronIPythonKernel. Did you import IPython.conftest, "
            "which instantiates a different kernel class?"
        )
        raise

    # Prepare the shell here as well, since users of this fixture may indirectly depend on it
    # e.g. the variables service.
    _prepare_shell(kernel.shell)

    return kernel


@pytest.fixture
def shell(kernel) -> Iterable[PositronShell]:
    shell = PositronShell.instance(parent=kernel)

    _prepare_shell(shell)

    user_ns_keys = set(shell.user_ns.keys())

    yield shell

    # Ensure a clean namespace
    new_user_ns_keys = set(shell.user_ns.keys()) - user_ns_keys
    for key in new_user_ns_keys:
        del shell.user_ns[key]
    shell.user_ns["_"] = ""


@pytest.fixture
def session(kernel) -> MockSession:
    session: MockSession = kernel.session

    # Clear all messages from previous tests.
    session.messages.clear()

    return session


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
def mock_display_pub(shell: PositronShell, monkeypatch: pytest.MonkeyPatch) -> Mock:
    mock = Mock()
    monkeypatch.setattr(shell, "display_pub", mock)
    return mock


@pytest.fixture
def mock_handle_request(monkeypatch: pytest.MonkeyPatch) -> Mock:
    mock = Mock()
    monkeypatch.setattr(HTTPServer, "handle_request", mock)
    return mock


@pytest.fixture
def variables_service(kernel: PositronIPythonKernel) -> VariablesService:
    """The Positron variables service."""
    return kernel.variables_service


@pytest.fixture
def variables_comm(variables_service: VariablesService) -> DummyComm:
    """Convenience fixture for accessing the variables comm."""
    # Open a comm
    variables_comm = DummyComm("dummy_variables_comm")
    variables_service.on_comm_open(variables_comm, {})

    # Clear messages due to the comm_open
    variables_comm.messages.clear()

    # Clear the snapshot
    variables_service._snapshot = None  # noqa: SLF001

    return variables_comm


@pytest.fixture
def de_service(kernel: PositronIPythonKernel):
    """The Positron dataviewer service."""
    fixture = kernel.data_explorer_service
    yield fixture
    fixture.shutdown()


@pytest.fixture
def connections_service(kernel: PositronIPythonKernel) -> ConnectionsService:
    """The Positron connections service."""
    return kernel.connections_service


@pytest.fixture
def enable_bokeh_output_notebook(shell: PositronShell) -> Iterable[None]:
    shell.run_cell(
        """\
from bokeh.plotting import figure, show, output_notebook
output_notebook()
"""
    )
    yield
    shell.run_cell(
        """\
from bokeh.io.import output
output.reset_output()
"""
    )

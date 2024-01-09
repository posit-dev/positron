#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
#

import os
from pathlib import Path
from typing import Any, Dict

import numpy as np
import pandas as pd
import polars as pl
import pytest
import torch

from positron.frontend import FrontendService
from positron.positron_ipkernel import PositronIPyKernel, PositronShell
from positron.utils import alias_home

from .conftest import DummyComm
from .utils import (
    comm_open_message,
    json_rpc_notification,
    json_rpc_request,
    json_rpc_response,
    preserve_working_directory,
)

TARGET_NAME = "target_name"


@pytest.fixture
def frontend_service(kernel: PositronIPyKernel) -> FrontendService:
    """
    The Positron frontend service.
    """
    return kernel.frontend_service


@pytest.fixture
def frontend_comm(frontend_service: FrontendService) -> DummyComm:
    """
    Open a dummy comm for the frontend service.
    """
    # TODO: Close any existing comms?

    # Open a comm
    frontend_comm = DummyComm(TARGET_NAME)
    frontend_service.on_comm_open(frontend_comm, {})

    # Clear messages due to the comm_open
    frontend_comm.messages.clear()

    return frontend_comm


def working_directory_event() -> Dict[str, Any]:
    return json_rpc_notification("working_directory", {"directory": str(alias_home(Path.cwd()))})


def test_comm_open(frontend_service: FrontendService) -> None:
    # Double-check that comm is not yet open
    assert frontend_service._comm is None

    # Open a comm
    frontend_comm = DummyComm(TARGET_NAME)
    frontend_service.on_comm_open(frontend_comm, {})

    # Check that the comm_open and initial working_directory messages are sent
    assert frontend_comm.messages == [comm_open_message(TARGET_NAME), working_directory_event()]


def test_set_console_width(frontend_comm: DummyComm) -> None:
    """
    Test the `setConsoleWidth` RPC method called from Positron.
    """
    width = 118
    msg = json_rpc_request(
        "call_method",
        {
            "method": "setConsoleWidth",
            "params": [width],
        },
    )
    frontend_comm.handle_msg(msg)

    # Check that the response is sent, with a result of None.
    assert frontend_comm.messages == [json_rpc_response(None)]

    # See the comments in positron.frontend._set_console_width for a description of these values.
    assert os.environ["COLUMNS"] == str(width)
    assert np.get_printoptions()["linewidth"] == width
    assert pd.get_option("display.width") is None
    assert pl.Config.state()["POLARS_TABLE_WIDTH"] == str(width)
    assert torch._tensor_str.PRINT_OPTS.linewidth == width


def test_open_editor(frontend_service: FrontendService, frontend_comm: DummyComm) -> None:
    file, line, column = "/Users/foo/bar/baz.py", 12, 34
    frontend_service.open_editor(file, line, column)

    assert frontend_comm.messages == [
        json_rpc_notification("open_editor", {"file": file, "line": line, "column": column})
    ]


def test_clear_console(frontend_service: FrontendService, frontend_comm: DummyComm) -> None:
    frontend_service.clear_console()

    assert frontend_comm.messages == [json_rpc_notification("clear_console", {})]


def test_poll_working_directory(shell: PositronShell, frontend_comm: DummyComm) -> None:
    # If a cell execution does not change the working directory, no comm messages should be sent.
    shell.run_cell("print()")

    assert frontend_comm.messages == []

    # If the working directory *does* change, a working directory event should be sent.
    with preserve_working_directory():
        shell.run_cell(
            """import os
os.chdir('..')"""
        )

        assert frontend_comm.messages == [working_directory_event()]


def test_shutdown(frontend_service: FrontendService, frontend_comm: DummyComm) -> None:
    # Double-check that the comm is not yet closed
    assert frontend_service._comm is not None
    assert not frontend_comm._closed

    frontend_service.shutdown()

    # Comm is closed
    assert frontend_comm._closed

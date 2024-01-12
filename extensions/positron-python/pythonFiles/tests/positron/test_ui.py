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

try:
    import torch  # type: ignore [reportMissingImports] for 3.12
except ImportError:
    torch = None

from positron.ui import UiService
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
def ui_service(kernel: PositronIPyKernel) -> UiService:
    """
    The Positron UI service.
    """
    return kernel.ui_service


@pytest.fixture
def ui_comm(ui_service: UiService) -> DummyComm:
    """
    Open a dummy comm for the UI service.
    """
    # TODO: Close any existing comms?

    # Open a comm
    ui_comm = DummyComm(TARGET_NAME)
    ui_service.on_comm_open(ui_comm, {})

    # Clear messages due to the comm_open
    ui_comm.messages.clear()

    return ui_comm


def working_directory_event() -> Dict[str, Any]:
    return json_rpc_notification("working_directory", {"directory": str(alias_home(Path.cwd()))})


def test_comm_open(ui_service: UiService) -> None:
    # Double-check that comm is not yet open
    assert ui_service._comm is None

    # Open a comm
    ui_comm = DummyComm(TARGET_NAME)
    ui_service.on_comm_open(ui_comm, {})

    # Check that the comm_open and initial working_directory messages are sent
    assert ui_comm.messages == [comm_open_message(TARGET_NAME), working_directory_event()]


def test_set_console_width(ui_comm: DummyComm) -> None:
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
    ui_comm.handle_msg(msg)

    # Check that the response is sent, with a result of None.
    assert ui_comm.messages == [json_rpc_response(None)]

    # See the comments in positron.ui._set_console_width for a description of these values.
    assert os.environ["COLUMNS"] == str(width)
    assert np.get_printoptions()["linewidth"] == width
    assert pd.get_option("display.width") is None
    assert pl.Config.state()["POLARS_TABLE_WIDTH"] == str(width)
    if torch is not None:  # temporary workaround for Python 3.12
        assert torch._tensor_str.PRINT_OPTS.linewidth == width


def test_open_editor(ui_service: UiService, ui_comm: DummyComm) -> None:
    file, line, column = "/Users/foo/bar/baz.py", 12, 34
    ui_service.open_editor(file, line, column)

    assert ui_comm.messages == [
        json_rpc_notification("open_editor", {"file": file, "line": line, "column": column})
    ]


def test_clear_console(ui_service: UiService, ui_comm: DummyComm) -> None:
    ui_service.clear_console()

    assert ui_comm.messages == [json_rpc_notification("clear_console", {})]


def test_poll_working_directory(shell: PositronShell, ui_comm: DummyComm) -> None:
    # If a cell execution does not change the working directory, no comm messages should be sent.
    shell.run_cell("print()")

    assert ui_comm.messages == []

    # If the working directory *does* change, a working directory event should be sent.
    with preserve_working_directory():
        shell.run_cell(
            """import os
os.chdir('..')"""
        )

        assert ui_comm.messages == [working_directory_event()]


def test_shutdown(ui_service: UiService, ui_comm: DummyComm) -> None:
    # Double-check that the comm is not yet closed
    assert ui_service._comm is not None
    assert not ui_comm._closed

    ui_service.shutdown()

    # Comm is closed
    assert ui_comm._closed

#
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
#

import os
from pathlib import Path
from typing import Any, Dict, Iterable, cast

import comm
import numpy as np
import pandas as pd
import polars as pl
import pytest
import torch
from IPython.terminal.interactiveshell import TerminalInteractiveShell

from positron.frontend import FrontendService
from positron.positron_ipkernel import POSITRON_FRONTEND_COMM, PositronIPyKernel
from positron.utils import alias_home

from .conftest import DummyComm


@pytest.fixture
def frontend_service(
    kernel: PositronIPyKernel,
) -> Iterable[FrontendService]:
    """
    A Positron frontend service with an open comm.
    """
    service = kernel.frontend_service

    # Close any existing comm
    if service._comm is not None:
        service._comm.close()
        service._comm = None

    # Open a comm
    comm_ = cast(DummyComm, comm.create_comm(POSITRON_FRONTEND_COMM))
    service.on_comm_open(comm_, {})

    # Clear messages due to the comm_open
    comm_.messages.clear()

    yield service

    # Close the comm
    comm_.close()
    service._comm = None


@pytest.fixture
def frontend_comm(frontend_service: FrontendService) -> DummyComm:
    """
    Convenience fixture for accessing the frontend comm.
    """
    assert frontend_service._comm is not None
    return cast(DummyComm, frontend_service._comm.comm)


def _working_directory_event() -> Dict[str, Any]:
    return {
        "data": {
            "jsonrpc": "2.0",
            "method": "working_directory",
            "params": {
                "directory": str(alias_home(Path.cwd())),
            },
        },
        "metadata": None,
        "buffers": None,
        "msg_type": "comm_msg",
    }


# We purposefully use the kernel fixture instead of frontend_service or frontend_comm
# so that the comm is not yet opened.
def test_comm_open(kernel: PositronIPyKernel) -> None:
    frontend_service = kernel.frontend_service

    # Double-check that comm is not yet open
    assert frontend_service._comm is None

    # Open a comm
    frontend_comm = cast(DummyComm, comm.create_comm("positron.frontend"))
    frontend_service.on_comm_open(frontend_comm, {})

    # Check that the comm_open and initial working_directory message are sent
    assert frontend_comm.messages == [
        {
            "data": {},
            "metadata": None,
            "buffers": None,
            "target_name": "positron.frontend",
            "target_module": None,
            "msg_type": "comm_open",
        },
        _working_directory_event(),
    ]


def test_poll_working_directory_post_execution(
    shell: TerminalInteractiveShell, frontend_comm: DummyComm
) -> None:
    # Running a cell that does not change the working directory should not send any comm messages.
    shell.run_cell("print()")

    assert frontend_comm.messages == []

    cwd = Path.cwd()

    # Running a cell that *does* change the working directory should send a working_directory event.
    shell.run_cell("import os; os.chdir('..')")

    assert frontend_comm.messages == [_working_directory_event()]

    # Restore the original working directory for remaining tests
    os.chdir(cwd)


def test_handle_rpc_request_set_console_width(frontend_comm: DummyComm) -> None:
    width = 118
    msg = {
        "content": {
            "data": {
                "jsonrpc": "2.0",
                "method": "call_method",
                "params": {
                    "method": "setConsoleWidth",
                    "params": [width],
                },
            }
        },
    }
    frontend_comm.handle_msg(msg)

    # Check that the response is sent, with a result of None.
    assert frontend_comm.messages == [
        {
            "data": {"jsonrpc": "2.0", "result": None},
            "metadata": None,
            "buffers": None,
            "msg_type": "comm_msg",
        }
    ]

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
        {
            "data": {
                "jsonrpc": "2.0",
                "method": "open_editor",
                "params": {"file": file, "line": line, "column": column},
            },
            "metadata": None,
            "buffers": None,
            "msg_type": "comm_msg",
        }
    ]


def test_clear_console(frontend_service: FrontendService, frontend_comm: DummyComm) -> None:
    frontend_service.clear_console()

    assert frontend_comm.messages == [
        {
            "data": {
                "jsonrpc": "2.0",
                "method": "clear_console",
                "params": {},
            },
            "metadata": None,
            "buffers": None,
            "msg_type": "comm_msg",
        }
    ]


def test_shutdown(frontend_service: FrontendService) -> None:
    # Double-check that the comm is not yet closed
    assert frontend_service._comm is not None
    frontend_comm = frontend_service._comm.comm
    assert frontend_comm is not None
    assert not frontend_comm._closed

    frontend_service.shutdown()

    # Comm is closed
    assert frontend_comm._closed

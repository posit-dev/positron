import os
from pathlib import Path
from typing import Any, Dict, Iterable, cast

import comm
import pytest
from IPython.terminal.interactiveshell import TerminalInteractiveShell

from positron.frontend import FrontendService
from positron.positron_ipkernel import PositronIPyKernel

from .conftest import DummyComm


@pytest.fixture
def frontend_service(
    kernel: PositronIPyKernel,
) -> Iterable[FrontendService]:
    """
    A Positron frontend service with an open comm.
    """
    frontend_service = kernel.frontend_service

    # Open a comm
    service_comm = cast(DummyComm, comm.create_comm("positron.frontend"))
    frontend_service.on_comm_open(service_comm, {})

    # Clear messages due to the comm_open
    service_comm.messages.clear()

    yield frontend_service


@pytest.fixture
def frontend_comm(frontend_service: FrontendService) -> DummyComm:
    """
    Convenience fixture for accessing the frontend comm.
    """
    return cast(DummyComm, frontend_service._comm)


def test_view_pandas_df_expression(shell):
    shell.run_cell("import pandas as pd\n" "%view pd.DataFrame({'x': [1,2,3]})")

    assert "view" in shell.magics_manager.magics["line"]


def test_view_pandas_df_var(shell):
    shell.run_cell(
        "import pandas as pd\n" "a = pd.DataFrame({'x': [1,2,3]})\n" "%view a", store_history=True
    )

    assert "view" in shell.magics_manager.magics["line"]
    assert "view" in shell.user_ns["In"][1]
    pd = shell.user_ns["pd"]
    assert isinstance(shell.user_ns["a"], pd.DataFrame)


def test_view_polars_df_var(shell):
    shell.run_cell("import polars as pl\n" "a = pl.DataFrame()\n" "%view a", store_history=True)

    assert "view" in shell.magics_manager.magics["line"]
    assert "view" in shell.user_ns["In"][1]
    pl = shell.user_ns["pl"]
    assert isinstance(shell.user_ns["a"], pl.DataFrame)


def test_view_unsupported_type(shell):
    with pytest.raises(TypeError):
        shell.run_line_magic("view", "12")


def _working_directory_event() -> Dict[str, Any]:
    # Get the current working directory
    current_dir = Path.cwd()
    # Alias ~ to the home directory
    home_dir = Path.home()
    try:
        # relative_to will raise a ValueError if current_dir is not within the home directory
        current_dir = Path("~") / current_dir.relative_to(home_dir)
    except ValueError:
        pass

    return {
        "data": {
            "msg_type": "event",
            "name": "working_directory",
            "data": {
                "directory": str(current_dir),
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
    open_msg = {}
    frontend_service.on_comm_open(frontend_comm, open_msg)

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

import os
from pathlib import Path
from typing import Any, Dict, Iterable, cast
from unittest.mock import Mock

import comm
import pytest
from IPython.terminal.interactiveshell import TerminalInteractiveShell
from IPython.utils.syspathcontext import prepended_to_syspath

from positron.frontend import FrontendService
from positron.positron_ipkernel import PositronIPyKernel, PositronShell

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


def _alias_home(path: Path) -> Path:
    """
    Alias the home directory to ~ in a path.
    """
    home_dir = Path.home()
    try:
        # relative_to will raise a ValueError if path is not within the home directory
        return Path("~") / path.relative_to(home_dir)
    except ValueError:
        return path


def _working_directory_event() -> Dict[str, Any]:
    # Get the current working directory
    current_dir = _alias_home(Path.cwd())

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


code = """def f():
    raise Exception("This is an error!")

def g():
    f()
"""


def test_traceback(tmp_path: Path) -> None:
    # We follow the approach of IPython's test_ultratb.py, which is to create a temporary module,
    # prepend its parent directory to sys.path, import it, then run a cell that calls a function
    # from it.

    # We can't use the shell fixture for this since it has non-ascii error messages and doesn't
    # send errors to the frontend.
    s = PositronShell()
    # The error message is sent via the displayhook.
    s.displayhook = Mock()

    # Create a temporary module.
    file = tmp_path / "foo.py"
    file.write_text(code)

    # Temporarily add the module to sys.path and call a function from it, which should error.
    with prepended_to_syspath(str(tmp_path)):
        s.run_cell("import foo; foo.g()")

    # NOTE(seem): This is not elegant, but I'm not sure how else to test this than other than to
    # compare the beginning of each frame of the traceback. The escape codes make it particularly
    # challenging.

    path = str(_alias_home(file))
    uri = file.expanduser().as_uri()

    # Define a few OSC8 escape codes for convenience.
    esc = "\x1b"
    osc8 = esc + "]8"
    st = esc + "\\"

    # Convenient reference to colors from the active scheme.
    colors = cast(Any, s.InteractiveTB.Colors)

    # This template matches the beginning of each traceback frame. We don't check each entire frame
    # because syntax highlighted code is full of escape codes. For example, after removing
    # escape codes a formatted version of below might look like:
    #
    # File /private/var/folders/.../foo.py:11, in func()
    #
    traceback_frame_header = "".join(
        [
            "File ",
            colors.filenameEm,
            # File paths are replaced with OSC8 links.
            osc8,
            ";line={line};",
            uri,
            st,
            path,
            ":{line}",
            osc8,
            ";;",
            st,
            colors.Normal,
            ", in ",
            colors.vName,
            "{func}",
            colors.valEm,
            "()",
            colors.Normal,
        ]
    )

    # Check that a single message was sent to the frontend.
    call_args_list = cast(Mock, s.displayhook.session.send).call_args_list
    assert len(call_args_list) == 1

    call_args = call_args_list[0]

    # Check that the message was sent over the "error" stream.
    assert call_args.args[1] == "error"

    exc_content = call_args.args[2]

    # Check that two frames were included (the top frame is included in the exception value below).
    traceback = exc_content["traceback"]
    assert len(traceback) == 2

    # Check the beginning of each frame.
    _assert_ansi_string_startswith(traceback[0], traceback_frame_header.format(line=5, func="g"))
    _assert_ansi_string_startswith(traceback[1], traceback_frame_header.format(line=2, func="f"))

    # Check the exception name.
    assert exc_content["ename"] == "Exception"

    # The exception value should include the top of the stack trace.
    _assert_ansi_string_startswith(
        exc_content["evalue"], "This is an error!\nFile " + colors.filenameEm
    )


def _assert_ansi_string_startswith(actual: str, expected: str) -> None:
    """
    Assert that an ansi-formatted string starts with an expected string, in a way that gets pytest
    to print a helpful diff.
    """
    # We manually trim each string instead of using str.startswith else pytest doesn't highlight
    # where strings differ. We compare reprs so that pytest displays escape codes instead of
    # interpreting them - it's easier to debug.
    length = min(len(actual), len(expected))
    actual = repr(actual[:length])
    expected = repr(expected[:length])
    assert actual == expected

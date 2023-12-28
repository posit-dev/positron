import os
from pathlib import Path
from typing import Any, cast
from unittest.mock import Mock

import pytest
from IPython.utils.syspathcontext import prepended_to_syspath

from positron.positron_ipkernel import PositronShell
from positron.utils import alias_home


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
    shell = PositronShell()
    # The error message is sent via the displayhook.
    shell.displayhook = Mock()

    # Create a temporary module.
    file = tmp_path / "test_traceback.py"
    file.write_text(code)

    # Temporarily add the module to sys.path and call a function from it, which should error.
    with prepended_to_syspath(str(tmp_path)):
        shell.run_cell("import test_traceback; test_traceback.g()")

    # NOTE(seem): This is not elegant, but I'm not sure how else to test this than other than to
    # compare the beginning of each frame of the traceback. The escape codes make it particularly
    # challenging.

    path = str(alias_home(file))
    uri = file.expanduser().as_uri()

    # Define a few OSC8 escape codes for convenience.
    esc = "\x1b"
    osc8 = esc + "]8"
    st = esc + "\\"

    # Convenient reference to colors from the active scheme.
    colors = cast(Any, shell.InteractiveTB.Colors)

    # This template matches the beginning of each traceback frame. We don't check each entire frame
    # because syntax highlighted code is full of escape codes. For example, after removing
    # escape codes a formatted version of below might look like:
    #
    # File /private/var/folders/.../test_traceback.py:11, in func()
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
    call_args_list = cast(Mock, shell.displayhook.session.send).call_args_list
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


def test_pinfo() -> None:
    """
    Redirect `object?` to the Positron help service's `show_help` method.
    """
    shell = PositronShell()

    shell.kernel = Mock()

    shell.run_cell("object?")

    shell.kernel.help_service.show_help.assert_called_once_with(object)


def test_pinfo_2(tmp_path: Path) -> None:
    """
    Redirect `object??` to the Positron frontend service's `open_editor` method.
    """
    shell = PositronShell()

    shell.kernel = Mock()

    # Create a temporary module using a predefined code snippet, so that we know the expected
    # file and line number where the object is defined.
    file = tmp_path / "test_pinfo_2.py"
    file.write_text(code)

    # Temporarily add the module to sys.path and run the `??` magic.
    with prepended_to_syspath(str(tmp_path)):
        shell.run_cell("import test_pinfo_2")
        shell.run_cell("test_pinfo_2.g??")

    # IPython normalizes the case of the file path.
    expected_file = os.path.normcase(file)
    shell.kernel.frontend_service.open_editor.assert_called_once_with(expected_file, 4, 0)

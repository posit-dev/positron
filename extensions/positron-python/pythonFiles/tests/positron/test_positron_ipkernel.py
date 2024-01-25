#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
#

import os
from pathlib import Path
from typing import Any, cast
from unittest.mock import Mock

import pandas as pd
import pytest
from IPython.utils.syspathcontext import prepended_to_syspath

from positron.help import help
from positron.utils import alias_home

from .conftest import PositronShell

from .utils import assert_dataset_registered

# The idea for these tests is to mock out communications with Positron via our various comms, and
# only test IPython interactions. For example, in testing the %view magic, we assert that running
# a cell with `%view` calls the datatool service's `register_table` method with the expected
# arguments. The actual messages sent over the comm are tested in the respective service tests.


def test_override_help(shell: PositronShell) -> None:
    """
    Check that we override the shell's `help` function with our own.
    """
    assert shell.user_ns["help"] == help
    assert shell.user_ns_hidden["help"] == help


def test_view_pandas_df_expression(shell: PositronShell, mock_datatool_service: Mock) -> None:
    expr = "pd.DataFrame({'x': [1,2,3]})"

    shell.run_cell(
        f"""import pandas as pd
%view {expr}"""
    )

    obj = pd.DataFrame({"x": [1, 2, 3]})
    assert_dataset_registered(mock_datatool_service, obj, expr)


def test_view_pandas_df_var(shell: PositronShell, mock_datatool_service: Mock) -> None:
    name = "a"
    shell.run_cell(
        f"""import pandas as pd
{name} = pd.DataFrame({{'x': [1,2,3]}})
%view {name}"""
    )

    obj = shell.user_ns[name]
    assert_dataset_registered(mock_datatool_service, obj, name)


def test_view_polars_df_var(shell: PositronShell, mock_datatool_service: Mock) -> None:
    name = "a"
    shell.run_cell(
        f"""import polars as pl
{name} = pl.DataFrame({{'x': [1,2,3]}})
%view {name}"""
    )

    obj = shell.user_ns[name]
    assert_dataset_registered(mock_datatool_service, obj, name)


def test_view_unsupported_type(shell: PositronShell) -> None:
    with pytest.raises(TypeError):
        shell.run_line_magic("view", "12")


code = """def f():
    raise Exception("This is an error!")

def g():
    f()
"""


def test_traceback(shell: PositronShell, tmp_path: Path, mock_displayhook: Mock) -> None:
    # We follow the approach of IPython's test_ultratb.py, which is to create a temporary module,
    # prepend its parent directory to sys.path, import it, then run a cell that calls a function
    # from it.

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
    call_args_list = mock_displayhook.session.send.call_args_list
    assert len(call_args_list) == 1

    call_args = call_args_list[0]

    # Check that the message was sent over the "error" stream.
    assert call_args.args[1] == "error"

    exc_content = call_args.args[2]

    # Check that two frames were included (the top frame is included in the exception value below).
    traceback = exc_content["traceback"]
    assert len(traceback) == 2

    # Check the beginning of each frame.
    assert_ansi_string_startswith(traceback[0], traceback_frame_header.format(line=5, func="g"))
    assert_ansi_string_startswith(traceback[1], traceback_frame_header.format(line=2, func="f"))

    # Check the exception name.
    assert exc_content["ename"] == "Exception"

    # The exception value should include the top of the stack trace.
    assert_ansi_string_startswith(
        exc_content["evalue"], "This is an error!\nCell " + colors.filenameEm
    )


def assert_ansi_string_startswith(actual: str, expected: str) -> None:
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


def test_pinfo(shell: PositronShell, mock_help_service: Mock) -> None:
    """
    Redirect `object?` to the Positron help service's `show_help` method.
    """
    shell.run_cell("object?")

    mock_help_service.show_help.assert_called_once_with(object)


def test_pinfo_2(shell: PositronShell, tmp_path: Path, mock_ui_service: Mock) -> None:
    """
    Redirect `object??` to the Positron UI service's `open_editor` method.
    """
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
    mock_ui_service.open_editor.assert_called_once_with(expected_file, 4, 0)


def test_clear(shell: PositronShell, mock_ui_service: Mock) -> None:
    """
    Redirect `%clear` to the Positron UI service's `clear_console` method.
    """
    shell.run_cell("%clear")

    mock_ui_service.clear_console.assert_called_once_with()

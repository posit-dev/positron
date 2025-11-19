#
# Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

import contextlib
import logging
import os
from pathlib import Path
from typing import Any, Tuple, cast
from unittest.mock import Mock

import IPython
import pytest
from ipykernel.compiler import get_tmp_directory
from IPython.core import ultratb
from IPython.utils.syspathcontext import prepended_to_syspath

from positron.access_keys import encode_access_key
from positron.help import help  # noqa: A004
from positron.session_mode import SessionMode
from positron.utils import alias_home

from .conftest import PositronShell
from .utils import assert_register_table_called

try:
    import lightning
except ImportError:
    lightning = None

# The idea for these tests is to mock out communications with Positron
# via our various comms, and only test IPython interactions. For
# example, in testing the %view magic, we assert that running a cell
# with `%view` calls the data_explorer service's `register_table`
# method with the expected arguments. The actual messages sent over
# the comm are tested in the respective service tests.

logger = logging.getLogger(__name__)


@pytest.fixture
def warning_kwargs():
    return {"message": "this is a warning", "category": UserWarning, "lineno": 3}


def test_override_help(shell: PositronShell) -> None:
    """Check that we override the shell's `help` function with our own."""
    assert shell.user_ns["help"] == help
    assert shell.user_ns_hidden["help"] == help


def test_view(shell: PositronShell, mock_dataexplorer_service: Mock) -> None:
    name = "x"
    shell.run_cell(f"{name} = object()\n%view {name}")
    assert_register_table_called(mock_dataexplorer_service, shell.user_ns[name], name)


def test_view_with_title(shell: PositronShell, mock_dataexplorer_service: Mock) -> None:
    name = "xt"
    title = "A custom title"
    path = [encode_access_key(name)]

    shell.run_cell(f'{name} = object()\n%view {name} "{title}"')
    assert_register_table_called(mock_dataexplorer_service, shell.user_ns[name], title, path)


def test_view_undefined(shell: PositronShell, mock_dataexplorer_service: Mock, capsys) -> None:
    name = "x"
    shell.run_cell(f"%view {name}")
    mock_dataexplorer_service.register_table.assert_not_called()
    assert "UsageError: Failed to evaluate expression" in capsys.readouterr().err


def test_view_title_unquoted(shell: PositronShell, mock_dataexplorer_service: Mock, capsys) -> None:
    shell.run_cell("%view x A custom title")
    mock_dataexplorer_service.register_table.assert_not_called()
    assert (
        capsys.readouterr().err
        == "UsageError: unrecognized arguments: custom title. Did you quote the title?\n"
    )


def test_view_unsupported_type(
    shell: PositronShell, mock_dataexplorer_service: Mock, capsys
) -> None:
    name = "x"
    mock_dataexplorer_service.register_table = Mock(side_effect=TypeError)

    shell.run_cell(f"{name} = object()\n%view {name}")

    assert_register_table_called(mock_dataexplorer_service, shell.user_ns[name], name)
    assert capsys.readouterr().err == "UsageError: cannot view object of type 'object'\n"


def test_view_simple_expression(shell: PositronShell, mock_dataexplorer_service: Mock) -> None:
    """Test that %view can evaluate a simple expression."""
    shell.run_cell("x = 5")
    expected_result = 6
    shell.run_cell('%view "x + 1"')
    mock_dataexplorer_service.register_table.assert_called_once()
    args, _kwargs = mock_dataexplorer_service.register_table.call_args
    assert args[0] is expected_result  # First arg is the object
    # Check that the title is either the quoted or unquoted expression (platform-dependent)
    assert args[1] in ('"x + 1"', "x + 1")


def test_view_complex_expression(shell: PositronShell, mock_dataexplorer_service: Mock) -> None:
    """Test that %view can evaluate a more complex expression with method calls."""
    shell.run_cell("my_list = [1, 2, 3]")
    expected_result = [1, 2, 6]
    shell.run_cell('%view "my_list[:2] + [sum(my_list)]"')
    mock_dataexplorer_service.register_table.assert_called_once()
    args, _kwargs = mock_dataexplorer_service.register_table.call_args
    assert args[0] == expected_result
    # Check that the title is either the quoted or unquoted expression (platform-dependent)
    assert args[1] in ('"my_list[:2] + [sum(my_list)]"', "my_list[:2] + [sum(my_list)]")


def test_view_expression_with_title(shell: PositronShell, mock_dataexplorer_service: Mock) -> None:
    """Test that %view can evaluate an expression and use a custom title."""
    shell.run_cell("x = 10")
    title = "Doubled Value"
    expected_result = 20
    shell.run_cell('%view "x * 2" "Doubled Value"')
    mock_dataexplorer_service.register_table.assert_called_once()
    args, _kwargs = mock_dataexplorer_service.register_table.call_args
    assert args[0] is expected_result
    assert args[1] == title


def test_view_expression_error(
    shell: PositronShell, mock_dataexplorer_service: Mock, capsys
) -> None:
    """Test that %view properly handles errors in expressions."""
    shell.run_cell('%view "undefined_var + 1"')
    mock_dataexplorer_service.register_table.assert_not_called()
    assert "Failed to evaluate expression" in capsys.readouterr().err


def assert_register_connection_called(mock_connections_service: Mock, obj: Any) -> None:
    call_args_list = mock_connections_service.register_connection.call_args_list
    assert len(call_args_list) == 1

    (passed_connection,) = call_args_list[0].args
    assert passed_connection is obj


def test_connection_show(shell: PositronShell, mock_connections_service: Mock) -> None:
    name = "x"
    shell.run_cell(f"{name} = object()\n%connection_show {name}")
    assert_register_connection_called(mock_connections_service, shell.user_ns[name])


def test_connection_show_undefined(
    shell: PositronShell, mock_connections_service: Mock, capsys
) -> None:
    name = "x"
    shell.run_cell(f"%connection_show {name}")
    mock_connections_service.register_connection.assert_not_called()
    assert capsys.readouterr().err == f"UsageError: name '{name}' is not defined\n"


def test_connection_show_unsupported_type(
    shell: PositronShell, mock_connections_service: Mock, capsys
) -> None:
    name = "x"
    mock_connections_service.register_connection = Mock(side_effect=TypeError)

    shell.run_cell(f"{name} = object()\n%connection_show {name}")

    assert_register_connection_called(mock_connections_service, shell.user_ns[name])
    assert capsys.readouterr().err == "UsageError: cannot show object of type 'object'\n"


code = """def f():
    raise Exception("This is an error!")

def g():
    f()
"""


@pytest.fixture
def traceback_result(
    request: pytest.FixtureRequest,
    shell: PositronShell,
    tmp_path: Path,
    mock_displayhook: Mock,
    monkeypatch,
) -> tuple[Path, Any]:
    # Ensure that we're in console mode.
    monkeypatch.setattr(shell, "session_mode", SessionMode.CONSOLE)

    # We follow the approach of IPython's test_ultratb.py, which is to create a temporary module,
    # prepend its parent directory to sys.path, import it, then run a cell that calls a function
    # from it.

    # Create a temporary module.
    file = tmp_path / f"{request.function.__name__}.py"
    file.write_text(code)

    # Temporarily add the module to sys.path and call a function from it, which should error.
    with prepended_to_syspath(str(tmp_path)):
        shell.run_cell(f"import {request.function.__name__} as test_traceback; test_traceback.g()")

    # Check that a single message was sent to the frontend.
    call_args_list = mock_displayhook.session.send.call_args_list
    assert len(call_args_list) == 1

    call_args = call_args_list[0]

    # Check that the message was sent over the "error" stream.
    assert call_args.args[1] == "error"

    exc_content = call_args.args[2]

    return (file, exc_content)


@pytest.mark.xfail(
    cast("Tuple[int, int]", (IPython.version_info[:2])) >= (9, 0),
    reason="IPython >= 9.0.0 does not support the old traceback format",
)
def test_console_traceback(shell: PositronShell, traceback_result) -> None:
    file, exc_content = traceback_result

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
    colors = cast("Any", shell.InteractiveTB.Colors)

    # This template matches the beginning of each traceback frame. We don't check each entire frame
    # because syntax highlighted code is full of escape codes. For example, after removing
    # escape codes a formatted version of below might look like:
    #
    # File /private/var/folders/.../test_traceback.py:11, in func()
    #
    traceback_frame_header = f"File {colors.filenameEm}{osc8};line={{line}};{uri}{st}{path}:{{line}}{osc8};;{st}{colors.Normal}, in {colors.vName}{{func}}{colors.valEm}(){colors.Normal}"

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


@pytest.mark.xfail(
    cast("Tuple[int, int]", (IPython.version_info[:2])) < (9, 0),
    reason="IPython < 9.0.0 does not support the new traceback format",
)
def test_console_traceback_ipy9(shell: PositronShell, traceback_result) -> None:
    file, exc_content = traceback_result

    # NOTE(seem): This is not elegant, but I'm not sure how else to test this than other than to
    # compare the beginning of each frame of the traceback. The escape codes make it particularly
    # challenging.
    path = str(alias_home(file))

    # NOTE (here and below): Ignoring types related to `theme_table` and `ultratb.Token`
    # as they will report undefined in IPython < 9.0.0.
    colors = ultratb.theme_table[shell.colors]  # type: ignore

    # This template matches the beginning of each traceback frame. We don't check each entire frame
    # because syntax highlighted code is full of escape codes. For example, after removing
    # escape codes a formatted version of below might look like:
    #
    # File /private/var/folders/.../test_traceback.py:11, in func()
    #
    traceback_frame_header = colors.format(
        [
            (ultratb.Token.NormalEm, "File "),  # type: ignore
            (ultratb.Token.FilenameEm, f"{path}:{{line}}"),  # type: ignore
            (ultratb.Token.Normal, ", in "),  # type: ignore
            (ultratb.Token.VName, "{func}"),  # type: ignore
            (ultratb.Token.ValEm, "()"),  # type: ignore
        ]
    )

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
        exc_content["evalue"],
        "This is an error!\n" + colors.format([(ultratb.Token.NormalEm, "Cell")]),  # type: ignore
    )


def test_notebook_traceback(
    shell: PositronShell, tmp_path: Path, mock_displayhook: Mock, monkeypatch
) -> None:
    # Ensure that we're in notebook mode.
    monkeypatch.setattr(shell, "session_mode", SessionMode.NOTEBOOK)

    # We follow the approach of IPython's test_ultratb.py, which is to create a temporary module,
    # prepend its parent directory to sys.path, import it, then run a cell that calls a function
    # from it.

    # Create a temporary module.
    file = tmp_path / "test_traceback.py"
    file.write_text(code)

    # Temporarily add the module to sys.path and call a function from it, which should error.
    with prepended_to_syspath(str(tmp_path)):
        shell.run_cell("import test_traceback; test_traceback.g()")

    # Check that a single message was sent to the frontend.
    call_args_list = mock_displayhook.session.send.call_args_list
    assert len(call_args_list) == 1

    call_args = call_args_list[0]

    # Check that the message was sent over the "error" stream.
    assert call_args.args[1] == "error"

    exc_content = call_args.args[2]

    # Check that we haven't removed any frames.
    # We don't check the traceback contents in this case since that's tested in IPython.
    assert len(exc_content["traceback"]) == 6

    # Check that we haven't modified any other contents.
    assert exc_content["ename"] == "Exception"
    assert exc_content["evalue"] == "This is an error!"


def assert_ansi_string_startswith(actual: str, expected: str) -> None:
    """
    Assert that an ansi-formatted string starts with an expected string.

    In a way that gets pytest to print a helpful diff.
    """
    # We manually trim each string instead of using str.startswith else pytest doesn't highlight
    # where strings differ. We compare reprs so that pytest displays escape codes instead of
    # interpreting them - it's easier to debug.
    length = min(len(actual), len(expected))
    actual = repr(actual[:length])
    expected = repr(expected[:length])
    assert actual == expected


def test_pinfo(shell: PositronShell, mock_help_service: Mock) -> None:
    """Redirect `object?` to the Positron help service's `show_help` method."""
    shell.run_cell("object?")

    mock_help_service.show_help.assert_called_once_with(object)


def test_pinfo_2(shell: PositronShell, tmp_path: Path, mock_ui_service: Mock) -> None:
    """Redirect `object??` to the Positron UI service's `open_editor` method."""
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
    """Redirect `%clear` to the Positron UI service's `clear_console` method."""
    shell.run_cell("%clear")

    mock_ui_service.clear_console.assert_called_once_with()


def test_question_mark_help(shell: PositronShell, mock_help_service: Mock) -> None:
    """Redirect `?` to the Positron Help service."""
    shell.run_cell("?")

    mock_help_service.show_help.assert_called_once_with("positron.utils.positron_ipykernel_usage")


def test_console_warning(shell: PositronShell, warning_kwargs):
    """Check message for warnings."""
    filename = get_tmp_directory() + os.sep + "12345678.py"

    with pytest.warns() as record:
        shell.kernel._showwarning(filename=filename, **warning_kwargs)  # noqa: SLF001

        assert len(record) == 1
        assert record[0].filename == "<positron-console-cell-1>"
        assert record[0].message == "this is a warning"


def test_console_warning_logger(shell: PositronShell, caplog, warning_kwargs):
    """Check that Positron files are sent to logs."""
    with caplog.at_level(logging.WARNING):
        shell.kernel._showwarning(filename=Path(__file__), **warning_kwargs)  # noqa: SLF001
        assert "this is a warning" in caplog.text


@pytest.mark.skipif(lightning is None, reason="lightning is not installed")
def test_import_lightning_and_torch_dynamo(shell: PositronShell) -> None:
    # See: https://github.com/posit-dev/positron/issues/5879
    shell.run_cell("import lightning").raise_error()
    # Earlier versions of torch will not have the dynamo module.
    with contextlib.suppress(ModuleNotFoundError):
        shell.run_cell("import torch._dynamo").raise_error()


def test_kernel_info(kernel):
    # 'supported_features' is only added in ipykernel 7.0.0, but we backport it to older versions
    # since it's used by Positron to detect debugger support.
    assert "supported_features" in kernel.kernel_info
    assert "debugger" in kernel.kernel_info["supported_features"]

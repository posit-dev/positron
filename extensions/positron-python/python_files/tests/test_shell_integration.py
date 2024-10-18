import importlib
import sys
from unittest.mock import Mock

import pythonrc


def test_decoration_success():
    importlib.reload(pythonrc)
    ps1 = pythonrc.PS1()

    ps1.hooks.failure_flag = False
    result = str(ps1)
    if sys.platform != "win32":
        assert (
            result
            == "\x1b]633;E;None\x07\x1b]633;D;0\x07\x1b]633;A\x07>>> \x1b]633;B\x07\x1b]633;C\x07"
        )
    else:
        pass


def test_decoration_failure():
    importlib.reload(pythonrc)
    ps1 = pythonrc.PS1()

    ps1.hooks.failure_flag = True
    result = str(ps1)
    if sys.platform != "win32":
        assert (
            result
            == "\x1b]633;E;None\x07\x1b]633;D;1\x07\x1b]633;A\x07>>> \x1b]633;B\x07\x1b]633;C\x07"
        )
    else:
        pass


def test_displayhook_call():
    importlib.reload(pythonrc)
    pythonrc.PS1()
    mock_displayhook = Mock()

    hooks = pythonrc.REPLHooks()
    hooks.original_displayhook = mock_displayhook

    hooks.my_displayhook("mock_value")

    mock_displayhook.assert_called_once_with("mock_value")


def test_excepthook_call():
    importlib.reload(pythonrc)
    pythonrc.PS1()
    mock_excepthook = Mock()

    hooks = pythonrc.REPLHooks()
    hooks.original_excepthook = mock_excepthook

    hooks.my_excepthook("mock_type", "mock_value", "mock_traceback")
    mock_excepthook.assert_called_once_with("mock_type", "mock_value", "mock_traceback")

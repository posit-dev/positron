#
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
#

import pandas as pd
import pytest
from unittest.mock import Mock, AsyncMock
from typing import Any

from positron.help import HelpService, ShowHelpEvent, ShowHelpEventKind


@pytest.fixture
def help_service():
    kernel = Mock()
    frontend_service = Mock()
    return HelpService(kernel=kernel, frontend_service=frontend_service)


def test_pydoc_server(help_service: HelpService):
    help_service.kernel.do_execute = AsyncMock()

    help_service.start()

    assert help_service.pydoc_thread is not None
    assert help_service.pydoc_thread.serving

    help_service.shutdown()

    assert not help_service.pydoc_thread.serving


def help():
    """
    Dummy help function used as a test case.

    NOTE: Once we figure out how to get a real Positron kernel in our tests, we should use the
          HelpService to override its help function and remove this dummy.
    """
    pass


# Simulate being defined in __main__, as it is when defined by the HelpService.
help.__module__ = "__main__"


@pytest.mark.parametrize(
    ("obj", "expected_path"),
    [
        (print, "print"),
        #
        # Not sure why, but pydoc fails to import DataFrame from pandas.core.frame,
        # but succeeds at importing from pandas.
        (pd.DataFrame, "pandas.DataFrame"),
        (pd.DataFrame(), "pandas.DataFrame"),
        ("pandas.core.frame.DataFrame", "pandas.DataFrame"),
        (pd.DataFrame.bfill, "pandas.DataFrame.bfill"),
        (pd.Series, "pandas.Series"),
        #
        (0, "int"),
        (int, "int"),
        # Keywords should resolve even though they aren't objects.
        ("async", "async"),
        # The overrided help function should resolve -- without a __main__ prefix.
        (help, "help"),
    ],
)
def test_show_help(obj: Any, expected_path: str, help_service: HelpService):
    url = "http://localhost:1234/"
    help_service.pydoc_thread = Mock()
    help_service.pydoc_thread.url = url

    help_service.show_help(obj)

    assert help_service.pydoc_thread is not None

    [event] = help_service.frontend_service.send_event.call_args.args

    assert isinstance(event, ShowHelpEvent)
    assert event.name == "show_help"
    assert event.kind == ShowHelpEventKind.url
    assert event.focus == True
    prefix = f"{url}get?key="
    assert event.content.startswith(prefix)
    assert event.content[len(prefix) :] == expected_path

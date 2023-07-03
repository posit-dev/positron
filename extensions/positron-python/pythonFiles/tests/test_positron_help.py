#
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
#

from typing import Any
from unittest.mock import Mock, AsyncMock
from urllib.request import urlopen

import pandas as pd
import pytest

from positron.help import HelpService, ShowHelpEvent, ShowHelpEventKind


@pytest.fixture
def help_service():
    kernel = Mock()
    frontend_service = Mock()
    return HelpService(kernel=kernel, frontend_service=frontend_service)


@pytest.fixture
def running_help_service(help_service: HelpService):
    # kernel.do_execute requires an AsyncMock else it errors if we await it.
    help_service.kernel.do_execute = AsyncMock()
    help_service.start()
    yield help_service
    help_service.shutdown()


def test_pydoc_server_starts_and_shuts_down(running_help_service: HelpService):
    help_service = running_help_service

    assert help_service.pydoc_thread is not None
    assert help_service.pydoc_thread.serving

    help_service.shutdown()

    assert not help_service.pydoc_thread.serving


def test_pydoc_server_parses_rst_docstrings(running_help_service: HelpService):
    """
    We should patch pydoc to return parsed reStructuredText docstrings as HTML.
    """
    help_service = running_help_service

    assert help_service.pydoc_thread is not None

    key = "pandas.read_csv"
    url = f"{help_service.pydoc_thread.url}get?key={key}"
    with urlopen(url) as f:
        html = f.read().decode("utf-8")

    # Html should include headers for each section of the docstring if parsed correctly.
    assert "<h4>Parameters</h4>" in html
    assert "<h4>Returns</h4>" in html
    assert "<h4>See Also</h4>" in html
    assert "<h4>Examples</h4>" in html

    # There should no longer be any <tt> or </tt> tags.
    assert "<tt>" not in html
    assert "</tt>" not in html


def test_pydoc_server_styling(running_help_service: HelpService):
    """
    We should pydoc should apply css styling
    """
    help_service = running_help_service

    assert help_service.pydoc_thread is not None

    key = "pandas.read_csv"
    url = f"{help_service.pydoc_thread.url}get?key={key}"
    with urlopen(url) as f:
        html = f.read().decode("utf-8")

    # Html should include stylesheet if added correctly
    assert '<link rel="stylesheet" type="text/css" href="_pydoc.css"' in html

    # There should no longer be any hot pink!
    assert "#ee77aa" not in html


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
    """
    Calling `show_help` should send a `ShowHelpEvent` to the frontend service.
    """
    # Mock the pydoc server
    url = "http://localhost:1234/"
    help_service.pydoc_thread = Mock()
    help_service.pydoc_thread.url = url

    help_service.show_help(obj)

    assert help_service.pydoc_thread is not None

    [event] = help_service.frontend_service.send_event.call_args.args

    # We should have sent a ShowHelpEvent with the expected content
    assert isinstance(event, ShowHelpEvent)
    assert event.name == "show_help"
    assert event.kind == ShowHelpEventKind.url
    assert event.focus == True
    prefix = f"{url}get?key="
    assert event.content.startswith(prefix)
    assert event.content[len(prefix) :] == expected_path

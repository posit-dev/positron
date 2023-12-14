#
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
#

from typing import Any, cast
from unittest.mock import AsyncMock, Mock
from urllib.request import urlopen

import comm
import numpy as np
import pandas as pd
import pytest
from positron.help import HelpService, help
from positron.help_comm import HelpEvent, HelpRequest

from .conftest import DummyComm


@pytest.fixture
def help_service():
    kernel = Mock()
    return HelpService(kernel=kernel)


@pytest.fixture
def running_help_service(help_service: HelpService):
    help_service.kernel.shell.user_ns_hidden = {}
    help_service.kernel.shell.user_ns = {}
    # kernel.do_execute requires an AsyncMock else it errors if we await it.
    help_service.kernel.do_execute = AsyncMock()
    help_service.start()
    yield help_service
    help_service.shutdown()


@pytest.fixture
def help_comm(help_service: HelpService) -> DummyComm:
    """
    Convenience fixture for accessing the environment comm.
    """
    # Close any existing comm
    if help_service._comm is not None:
        help_service._comm.close()
        help_service._comm = None
    return cast(DummyComm, comm.create_comm("positron.help"))


def test_pydoc_server_starts_and_shuts_down(running_help_service: HelpService):
    help_service = running_help_service

    assert help_service.pydoc_thread is not None
    assert help_service.pydoc_thread.serving

    help_service.shutdown()

    assert not help_service.pydoc_thread.serving


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
        (pd.DataFrame.merge, "pandas.DataFrame.merge"),
        (pd.Series, "pandas.Series"),
        #
        (0, "int"),
        (int, "int"),
        # A module
        (np, "numpy"),
        # Numpy ufuncs
        (np.abs, "numpy.absolute"),
        # getset_descriptors
        (np.float_.base, "numpy.generic.base"),
        # Keywords should resolve even though they aren't objects.
        ("async", "async"),
        # The overrided help function should resolve.
        (help, "positron.help.help"),
    ],
)
def test_show_help(obj: Any, expected_path: str, help_service: HelpService, help_comm: DummyComm):
    """
    Calling `show_help` should send a `ShowHelpContent` to the help service.
    """
    # Mock the pydoc server
    url = "http://localhost:1234/"
    help_service.pydoc_thread = Mock()
    help_service.pydoc_thread.url = url

    # Open a comm
    open_msg = {}
    help_service.on_comm_open(help_comm, open_msg)
    help_comm.messages.clear()

    help_service.show_help(obj)

    assert help_service.pydoc_thread is not None
    assert help_service._comm is not None

    [event] = help_service._comm.comm.messages  # type: ignore

    # We should have sent a ShowHelpContent with the expected content
    assert event["data"]["method"] == HelpEvent.ShowHelp.value
    assert event["data"]["params"]["kind"] == "url"
    assert event["data"]["params"]["focus"] == True
    prefix = f"{url}get?key="
    assert event["data"]["params"]["content"].startswith(prefix)
    assert event["data"]["params"]["content"][len(prefix) :] == expected_path


def test_handle_show_topic_request_message_type(
    help_service: HelpService, help_comm: DummyComm
) -> None:
    open_msg = {}
    help_service.on_comm_open(help_comm, open_msg)
    help_comm.messages.clear()

    msg = {
        "content": {
            "data": {
                "jsonrpc": "2.0",
                "method": HelpRequest.ShowHelpTopic.value,
                "params": {"topic": "logging"},
            }
        }
    }
    help_comm.handle_msg(msg)
    data = msg["content"]["data"]
    method = data.get("method", None)

    assert method == HelpRequest.ShowHelpTopic.value

    assert len(help_comm.messages) == 1
    assert help_comm.messages == [
        {
            "data": {"jsonrpc": "2.0", "result": True},
            "metadata": None,
            "buffers": None,
            "msg_type": "comm_msg",
        }
    ]

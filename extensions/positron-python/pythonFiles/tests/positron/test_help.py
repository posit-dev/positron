#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
#

from typing import Any
from unittest.mock import Mock
from urllib.request import urlopen

import numpy as np
import pandas as pd
import pytest

from positron.help import HelpService, help
from positron.help_comm import HelpFrontendEvent, HelpBackendRequest

from .conftest import DummyComm
from .utils import json_rpc_request

TARGET_NAME = "target_name"


@pytest.fixture
def help_service() -> HelpService:
    """
    A Positron help service.
    """
    return HelpService()


@pytest.fixture
def running_help_service(help_service: HelpService):
    help_service.start()
    yield help_service
    help_service.shutdown()


@pytest.fixture
def help_comm(help_service: HelpService) -> DummyComm:
    """
    Open a dummy comm for the help service.
    """
    # Open a comm
    help_comm = DummyComm(TARGET_NAME)
    help_service.on_comm_open(help_comm, {})

    # Clear messages due to the comm_open
    help_comm.messages.clear()

    return help_comm


def test_pydoc_server_starts_and_shuts_down(running_help_service: HelpService):
    help_service = running_help_service

    assert help_service._pydoc_thread is not None
    assert help_service._pydoc_thread.serving

    help_service.shutdown()

    assert not help_service._pydoc_thread.serving


def test_pydoc_server_styling(running_help_service: HelpService):
    """
    We should pydoc should apply css styling
    """
    help_service = running_help_service

    assert help_service._pydoc_thread is not None

    key = "pandas.read_csv"
    url = f"{help_service._pydoc_thread.url}get?key={key}"
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
def test_show_help(
    obj: Any, expected_path: str, help_service: HelpService, help_comm: DummyComm, monkeypatch
):
    """
    Calling `show_help` should resolve an object to a url and send a `ShowHelp` event over the comm.
    """
    # Mock the pydoc server
    url = "http://localhost:1234/"
    mock_pydoc_thread = Mock()
    mock_pydoc_thread.url = url
    monkeypatch.setattr(help_service, "_pydoc_thread", mock_pydoc_thread)

    help_service.show_help(obj)

    [event] = help_comm.messages
    data = event["data"]
    assert data["method"] == HelpFrontendEvent.ShowHelp.value

    params = data["params"]
    assert params["kind"] == "url"
    assert params["focus"] == True
    prefix = f"{url}get?key="
    assert params["content"].startswith(prefix)
    assert params["content"][len(prefix) :] == expected_path


def test_handle_show_help_topic(
    help_service: HelpService, help_comm: DummyComm, monkeypatch
) -> None:
    # Mock the show_help method
    mock_show_help = Mock()
    monkeypatch.setattr(help_service, "show_help", mock_show_help)

    msg = json_rpc_request(
        HelpBackendRequest.ShowHelpTopic, {"topic": "logging"}, comm_id="dummy_comm_id"
    )
    help_comm.handle_msg(msg)

    assert help_comm.messages == [
        {
            "data": {"jsonrpc": "2.0", "result": True},
            "metadata": None,
            "buffers": None,
            "msg_type": "comm_msg",
        }
    ]

    mock_show_help.assert_called_once_with("logging")

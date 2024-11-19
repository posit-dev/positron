#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

from typing import Any
from unittest.mock import Mock
from urllib.request import urlopen

import numpy as np
import pandas as pd
import pytest

from positron_ipykernel.help import HelpService, help
from positron_ipykernel.help_comm import HelpBackendRequest, HelpFrontendEvent, ShowHelpKind

from .conftest import DummyComm
from .utils import json_rpc_notification, json_rpc_request, json_rpc_response

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
def help_comm(help_service: HelpService):
    """
    Open a dummy comm for the help service.
    """
    # Open a comm
    help_comm = DummyComm(TARGET_NAME)
    help_service.on_comm_open(help_comm, {})
    assert help_service._comm is not None, "Comm was not created"

    # Clear messages due to the comm_open
    help_comm.messages.clear()

    return help_service._comm


@pytest.fixture
def mock_pydoc_thread(help_service, monkeypatch):
    mock_pydoc_thread = Mock()
    mock_pydoc_thread.url = "http://localhost:1234/"
    monkeypatch.setattr(help_service, "_pydoc_thread", mock_pydoc_thread)
    return mock_pydoc_thread


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


def show_help_event(content: str, kind=ShowHelpKind.Url, focus=True):
    return json_rpc_notification(
        HelpFrontendEvent.ShowHelp.value, {"kind": kind, "focus": focus, "content": content}
    )


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
        (np.float32.base, "numpy.generic.base"),
        # Keywords should resolve even though they aren't objects.
        ("async", "async"),
        # The overrided help function should resolve.
        (help, "positron_ipykernel.help.help"),
    ],
)
def test_show_help(
    obj: Any, expected_path: str, help_service: HelpService, help_comm, mock_pydoc_thread
):
    """
    Calling `show_help` should resolve an object to a url and send a `ShowHelp` event over the comm.
    """
    help_service.show_help(obj)

    assert help_comm.messages == [
        show_help_event(f"{mock_pydoc_thread.url}get?key={expected_path}")
    ]


def test_handle_show_help_topic(help_comm, mock_pydoc_thread) -> None:
    msg = json_rpc_request(
        HelpBackendRequest.ShowHelpTopic, {"topic": "logging"}, comm_id="dummy_comm_id"
    )
    help_comm.handle_msg(msg)

    assert help_comm.messages == [
        json_rpc_response(True),
        show_help_event(f"{mock_pydoc_thread.url}get?key=logging"),
    ]

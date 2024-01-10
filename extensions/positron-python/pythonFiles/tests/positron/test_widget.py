#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
#

from typing import Iterable, cast

import comm
import ipywidgets as widgets
import pytest
from IPython.core.formatters import DisplayFormatter
from IPython.core.getipython import get_ipython
from positron.widget import PositronWidgetHook

from .conftest import DummyComm, PositronShell


@pytest.fixture(autouse=True)
def setup_shell(shell: PositronShell) -> Iterable[None]:
    # Enable all IPython mimetype formatters
    display_formatter = cast(DisplayFormatter, shell.display_formatter)
    active_types = display_formatter.active_types
    display_formatter.active_types = display_formatter.format_types

    yield

    # Restore the original active formatters
    display_formatter.active_types = active_types


@pytest.fixture
def hook() -> PositronWidgetHook:
    return PositronWidgetHook("jupyter.widget", comm_manager=None)


@pytest.fixture
def widget_comm(hook: PositronWidgetHook) -> DummyComm:
    """
    A comm corresponding to a test widget belonging to the Positron display publisher hook.
    """
    # Initialize the hook by calling it on a widget
    msg = {
        "content": {"data": {"application/vnd.jupyter.widget-view+json": {"model_id": 1234}}},
        "msg_type": "display_data",
    }
    hook(msg)

    # Return the comm corresponding to the first figure
    id = next(iter(hook.comms))
    widget_comm = cast(DummyComm, hook.comms[id])

    # Clear messages due to the comm_open
    widget_comm.messages.clear()

    return widget_comm


def test_hook_call_noop_on_non_display_data(hook: PositronWidgetHook) -> None:
    msg = {"msg_type": "not_display_data"}
    assert hook(msg) == msg
    assert hook.comms == {}


def test_hook_call_noop_on_no_model_id(hook: PositronWidgetHook) -> None:
    msg = {
        "content": {"data": {"application/vnd.jupyter.widget-view+json": {}}},
        "msg_type": "display_data",
    }
    assert hook(msg) == msg
    assert hook.comms == {}

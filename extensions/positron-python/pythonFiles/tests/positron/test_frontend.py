#
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
#

from dataclasses import dataclass
from typing import ClassVar
from unittest.mock import Mock, call

import pytest
from positron.frontend import BaseFrontendEvent, FrontendService


@pytest.fixture()
def frontend_service() -> FrontendService:
    return FrontendService()


@dataclass
class DummyFrontendEvent:
    foo: str = "foo"
    bar: int = 1

    name: str = "dummy"


def test_send_event_no_comm(frontend_service: FrontendService, caplog):
    frontend_service._comm = None
    event = DummyFrontendEvent()

    frontend_service.send_event(event=event)

    # A warning log is emitted
    assert len(caplog.records) == 1
    assert caplog.records[0].levelname == "WARNING"


def test_send_event(frontend_service: FrontendService):
    frontend_service._comm = Mock()
    event = DummyFrontendEvent()

    frontend_service.send_event(event=event)

    # Serialized event message is sent over the comm
    expected_msg = {"name": "dummy", "data": {"foo": "foo", "bar": 1}, "msg_type": "event"}
    assert frontend_service._comm.send.call_args_list == [call(expected_msg)]


def test_shutdown(frontend_service: FrontendService):
    frontend_service._comm = Mock()

    frontend_service.shutdown()

    # The comm is closed
    assert frontend_service._comm.close.call_count == 1

#
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
#

import enum
from dataclasses import dataclass, field
from typing import ClassVar, List

from .utils import JsonData


@enum.unique
class FrontendMessageType(str, enum.Enum):
    Event = "event"
    RpcRequest = "rpc_request"


@enum.unique
class FrontendEventType(str, enum.Enum):
    WorkingDirectory = "working_directory"


@dataclass
class FrontendEventData:
    name: ClassVar[FrontendEventType]


@dataclass
class FrontendEvent:
    name: FrontendEventType
    data: FrontendEventData
    msg_type: FrontendMessageType = FrontendMessageType.Event

    @classmethod
    def from_event_data(cls, data: "FrontendEventData") -> "FrontendEvent":
        return cls(name=data.name, data=data)


@dataclass
class WorkingDirectoryEvent(FrontendEventData):
    """
    Change the displayed working directory for the interpreter.
    """

    directory: str = field(metadata={"description": "The new working directory."})

    name: ClassVar[FrontendEventType] = FrontendEventType.WorkingDirectory


@dataclass
class FrontendRpcRequest:
    jsonrpc: str
    method: str
    params: List[JsonData]
    msg_type: FrontendMessageType

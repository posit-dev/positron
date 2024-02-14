#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
#

from __future__ import annotations

import enum
import logging
from typing import Callable, Generic, Optional, Type, TypeVar

import comm
from ._vendor.pydantic import ValidationError
from ._vendor.pydantic.generics import GenericModel

from . import data_tool_comm
from . import help_comm
from . import plot_comm
from . import variables_comm
from . import ui_comm
from .utils import JsonData, JsonRecord


logger = logging.getLogger(__name__)


## Create an enum of JSON-RPC error codes
@enum.unique
class JsonRpcErrorCode(enum.IntEnum):
    PARSE_ERROR = -32700
    INVALID_REQUEST = -32600
    METHOD_NOT_FOUND = -32601
    INVALID_PARAMS = -32602
    INTERNAL_ERROR = -32603


T_content = TypeVar(
    "T_content",
    data_tool_comm.DataToolBackendMessageContent,
    help_comm.HelpBackendMessageContent,
    plot_comm.PlotBackendMessageContent,
    variables_comm.VariablesBackendMessageContent,
    ui_comm.UiBackendMessageContent,
)


class CommMessage(GenericModel, Generic[T_content]):
    content: T_content


class PositronComm:
    """A wrapper around a base IPython comm that provides a JSON-RPC interface"""

    def __init__(self, comm: comm.base_comm.BaseComm) -> None:
        self.comm = comm

    def on_msg(
        self,
        callback: Callable[[CommMessage[T_content], JsonRecord], None],
        content_cls: Type[T_content],
    ) -> None:
        """
        Register a callback for an RPC request from the frontend.

        Will be called with both the parsed `msg: CommMessage` and the original `raw_msg`.

        If the `raw_msg` could not be parsed, a JSON-RPC error will be sent to the frontend.
        """

        def handle_msg(
            raw_msg: JsonRecord,
        ) -> None:
            try:
                comm_msg = CommMessage[content_cls].parse_obj(raw_msg)
            except ValidationError as exception:
                # Check if the error is due to an unknown method
                for error in exception.errors():
                    # Since Pydantic doesn't support discriminated unions with a single type,
                    # we use a constant `method` in those cases, and have to check them separately.
                    if (
                        # Comms with multiple backend request methods will have a discriminated_union error
                        error["loc"] == ("content", "data")
                        and error["type"] == "value_error.discriminated_union.invalid_discriminator"
                        and error["ctx"]["discriminator_key"] == "method"
                    ):
                        method = error["ctx"]["discriminator_value"]
                        self.send_error(
                            JsonRpcErrorCode.METHOD_NOT_FOUND, f"Unknown method '{method}'"
                        )
                        return

                    elif (
                        # Comms with a single backend request method will have a const error
                        error["loc"] == ("content", "data", "method")
                        and error["type"] == "value_error.const"
                    ):
                        method = error["ctx"]["given"]
                        self.send_error(
                            JsonRpcErrorCode.METHOD_NOT_FOUND, f"Unknown method '{method}'"
                        )
                        return

                self.send_error(JsonRpcErrorCode.INVALID_REQUEST, f"Invalid request: {exception}")
                return

            callback(comm_msg, raw_msg)

        self.comm.on_msg(handle_msg)

    def send_result(self, data: JsonData = None, metadata: Optional[JsonRecord] = None) -> None:
        """Send a JSON-RPC result to the frontend-side version of this comm"""
        result = dict(
            jsonrpc="2.0",
            result=data,
        )
        self.comm.send(
            data=result,
            metadata=metadata,
            buffers=None,
        )

    def send_event(self, name: str, payload: JsonRecord) -> None:
        """Send a JSON-RPC notification (event) to the frontend-side version of this comm"""
        event = dict(
            jsonrpc="2.0",
            method=name,
            params=payload,
        )
        self.comm.send(data=event)

    def send_error(self, code: JsonRpcErrorCode, message: Optional[str] = None) -> None:
        """Send a JSON-RPC result to the frontend-side version of this comm"""
        error = dict(
            jsonrpc="2.0",
            error=dict(
                code=code.value,
                message=message,
            ),
        )
        self.comm.send(
            data=error,
            metadata=None,
            buffers=None,
        )

    def close(self) -> None:
        """Close the underlying comm."""
        self.comm.close()

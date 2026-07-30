#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

from __future__ import annotations

import os
from contextlib import contextmanager
from pathlib import Path
from typing import TYPE_CHECKING, Any, Generator
from unittest.mock import Mock, patch

if TYPE_CHECKING:
    from positron._vendor.pydantic import BaseModel
    from positron.utils import JsonData, JsonRecord


def assert_pydantic_model_equal(actual: BaseModel, expected: BaseModel, exclude: set[str]) -> None:
    actual_dict = actual.dict(exclude=exclude)
    expected_dict = expected.dict(exclude=exclude)
    assert actual_dict == expected_dict


@contextmanager
def preserve_working_directory():
    """Reset the working directory after the context exits."""
    cwd = Path.cwd()
    try:
        yield
    finally:
        os.chdir(cwd)


def assert_register_table_called(
    mock_dataexplorer_service: Mock, obj: Any, title: str, variable_path: list[str] | None = None
) -> None:
    call_args_list = mock_dataexplorer_service.register_table.call_args_list
    assert len(call_args_list) == 1

    passed_table, passed_title = call_args_list[0].args
    assert passed_title == title
    assert passed_table is obj

    if variable_path is not None:
        call_args_kw = mock_dataexplorer_service.register_table.call_args.kwargs
        passed_variable_path = call_args_kw.get("variable_path", None)
        assert passed_variable_path is not None
        assert len(passed_variable_path) == len(variable_path)
        assert passed_variable_path[0] == variable_path[0]


def comm_message(
    data: JsonRecord | None = None,
) -> JsonRecord:
    if data is None:
        data = {}
    return {
        "data": data,
        "metadata": None,
        "buffers": None,
        "msg_type": "comm_msg",
    }


def comm_request(data: JsonRecord, **kwargs) -> JsonRecord:
    return {"content": {"data": data, **kwargs.pop("content", {})}, **kwargs}


def comm_open_message(target_name: str, data: JsonRecord | None = None) -> JsonRecord:
    return {
        **comm_message(data),
        "target_name": target_name,
        "target_module": None,
        "msg_type": "comm_open",
    }


def comm_close_message() -> JsonRecord:
    return {
        **comm_message(),
        "msg_type": "comm_close",
    }


def json_rpc_error(code: int, message: str) -> JsonRecord:
    return comm_message(
        {
            "jsonrpc": "2.0",
            "error": {
                "code": code,
                "message": message,
            },
        }
    )


def json_rpc_notification(method: str, params: JsonRecord | None = None) -> JsonRecord:
    return comm_message(
        {
            "jsonrpc": "2.0",
            "method": method,
            "params": {} if params is None else params,
        }
    )


def json_rpc_request(
    method: str,
    params: JsonRecord | None = None,
    **content: JsonData,
) -> JsonRecord:
    data = {"params": params} if params else {}
    return {
        "content": {
            "data": {
                "jsonrpc": "2.0",
                "id": "test-id",
                "method": method,
                **data,
            },
            **content,
        },
        "header": {},
    }


def json_rpc_response(result: JsonData) -> JsonRecord:
    return comm_message(
        {
            "jsonrpc": "2.0",
            "result": result,
        }
    )


# remove "<class '...'>" from value
def get_type_as_str(value: Any) -> str:
    return repr(type(value))[8:-2]


def percent_difference(actual: float, expected: float) -> float:
    return abs(actual - expected) / actual


def dummy_rpc_request(*args):
    return json_rpc_request(*args, comm_id="dummy_comm_id")


@contextmanager
def patch_positron_execute_request(positron: dict | None = None):
    """Patch the shell's get_parent to return a message with the given positron dict."""
    from positron.positron_ipkernel import PositronIPyKernel

    kernel = PositronIPyKernel.instance()
    positron = positron or {}
    parent = {"content": {"positron": positron}}
    with patch.object(kernel, "get_parent", return_value=parent):
        yield


def run_with_metadata(code: str, positron: dict | None = None):
    """Run a cell with the given positron metadata."""
    from positron.positron_ipkernel import PositronShell

    shell = PositronShell.instance()
    with patch_positron_execute_request(positron):
        return shell.run_cell(code).raise_error()


class CapturedError:
    """A captured kernel error message."""

    def __init__(self, ename: str, evalue: str, traceback: list[str]):
        self.ename = ename
        self.evalue = evalue
        self.traceback = traceback


@contextmanager
def capture_errors() -> Generator[list[CapturedError], None, None]:
    """Capture errors published by the kernel."""
    from positron.positron_ipkernel import PositronShell

    shell = PositronShell.instance()
    errors: list[CapturedError] = []
    session = shell.displayhook.session  # type: ignore
    original_send = session.send

    def send(stream, msg_or_type=None, content=None, *args, **kwargs):
        if msg_or_type == "error" and content is not None:
            error = CapturedError(
                ename=content["ename"],
                evalue=content["evalue"],
                traceback=content["traceback"],
            )
            errors.append(error)
        return original_send(stream, msg_or_type, content, *args, **kwargs)

    session.send = send
    try:
        yield errors
    finally:
        session.send = original_send

#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

import os
from contextlib import contextmanager
from pathlib import Path
from typing import Any, List, Optional, Set
from unittest.mock import Mock

from positron_ipykernel._vendor.pydantic import BaseModel
from positron_ipykernel.utils import JsonData, JsonRecord


def assert_pydantic_model_equal(actual: BaseModel, expected: BaseModel, exclude: Set[str]) -> None:
    actual_dict = actual.dict(exclude=exclude)
    expected_dict = expected.dict(exclude=exclude)
    assert actual_dict == expected_dict


@contextmanager
def preserve_working_directory():
    """
    Reset the working directory after the context exits.
    """
    cwd = Path.cwd()
    try:
        yield
    finally:
        os.chdir(cwd)


def assert_register_table_called(
    mock_dataexplorer_service: Mock, obj: Any, title: str, variable_path: Optional[List[str]] = None
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
    data: Optional[JsonRecord] = None,
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


def comm_open_message(target_name: str, data: Optional[JsonRecord] = None) -> JsonRecord:
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


def json_rpc_notification(method: str, params: JsonRecord) -> JsonRecord:
    return comm_message(
        {
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        }
    )


def json_rpc_request(
    method: str,
    params: Optional[JsonRecord] = None,
    **content: JsonData,
) -> JsonRecord:
    data = {"params": params} if params else {}
    return {
        "content": {
            "data": {
                "jsonrpc": "2.0",
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

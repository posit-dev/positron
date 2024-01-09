#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
#

import os
from contextlib import contextmanager
from dataclasses import asdict
from pathlib import Path
from typing import Any, Dict, List, Optional
from unittest.mock import Mock

from positron.inspectors import get_inspector
from positron.utils import DataclassProtocol, JsonData


def assert_dataclass_equal(
    actual: DataclassProtocol, expected: DataclassProtocol, exclude: List[str]
) -> None:
    actual_dict = asdict(actual)
    expected_dict = asdict(expected)

    [actual_dict.pop(key) for key in exclude]
    [expected_dict.pop(key) for key in exclude]

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


def assert_dataset_registered(mock_dataviewer_service: Mock, obj: Any, title: str) -> None:
    call_args_list = mock_dataviewer_service.register_dataset.call_args_list
    assert len(call_args_list) == 1

    call_args = call_args_list[0].args

    actual = call_args[0]
    expected = get_inspector(obj).to_dataset(obj, title)

    assert_dataclass_equal(actual, expected, ["id"])


def comm_message(data: Optional[Dict[str, JsonData]] = None) -> Dict[str, JsonData]:
    if data is None:
        data = {}
    return {"data": data, "metadata": None, "buffers": None, "msg_type": "comm_msg"}


def comm_request(data: Dict[str, JsonData], **kwargs) -> Dict[str, JsonData]:
    return {"content": {"data": data, **kwargs.pop("content", {})}, **kwargs}


def comm_open_message(
    target_name: str, data: Optional[Dict[str, JsonData]] = None
) -> Dict[str, JsonData]:
    return {
        **comm_message(data),
        "target_name": target_name,
        "target_module": None,
        "msg_type": "comm_open",
    }


def json_rpc_error(code: int, message: str) -> Dict[str, JsonData]:
    return comm_message(
        {
            "jsonrpc": "2.0",
            "error": {
                "code": code,
                "message": message,
            },
        }
    )


def json_rpc_notification(method: str, params: Dict[str, JsonData]) -> Dict[str, JsonData]:
    return comm_message(
        {
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        }
    )


def json_rpc_request(
    method: str, params: Optional[Dict[str, JsonData]] = None, **content: JsonData
) -> Dict[str, JsonData]:
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
    }


def json_rpc_response(result: JsonData) -> Dict[str, JsonData]:
    return comm_message(
        {
            "jsonrpc": "2.0",
            "result": result,
        }
    )

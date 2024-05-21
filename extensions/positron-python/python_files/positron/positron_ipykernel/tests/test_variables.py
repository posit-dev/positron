#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
#

from __future__ import annotations

import asyncio
from typing import Any, List, Type, cast
from unittest.mock import Mock, patch

import numpy as np
import pandas as pd
import polars as pl
import pytest
from positron_ipykernel import variables as variables_module
from positron_ipykernel.access_keys import encode_access_key
from positron_ipykernel.inspectors import get_inspector
from positron_ipykernel.positron_comm import JsonRpcErrorCode
from positron_ipykernel.positron_ipkernel import PositronIPyKernel
from positron_ipykernel.utils import JsonRecord, not_none
from positron_ipykernel.variables import VariablesService, _summarize_children, _summarize_variable

from .conftest import DummyComm, PositronShell
from .utils import (
    assert_register_table_called,
    comm_open_message,
    json_rpc_error,
    json_rpc_notification,
    json_rpc_request,
    json_rpc_response,
)

BIG_ARRAY_LENGTH = 10_000_001
TARGET_NAME = "target_name"


def test_comm_open(kernel: PositronIPyKernel) -> None:
    service = VariablesService(kernel)

    # Double-check that comm is not yet open
    assert service._comm is None

    # Open a comm
    variables_comm = DummyComm(TARGET_NAME)
    service.on_comm_open(variables_comm, {})

    # Check that the comm_open and empty refresh messages were sent
    assert variables_comm.messages == [
        comm_open_message(TARGET_NAME),
        json_rpc_notification("refresh", {"variables": [], "length": 0, "version": 0}),
    ]


@pytest.mark.parametrize(
    ("import_code", "value_codes"),
    [
        #
        # Same types
        #
        ("import numpy as np", [f"x = np.array({x})" for x in [3, [3], [[3]]]]),
        ("import torch", [f"x = torch.tensor({x})" for x in [3, [3], [[3]]]]),
        pytest.param(
            "import pandas as pd",
            [f"x = pd.Series({x})" for x in [[], [3], [3, 3], ["3"]]],
        ),
        pytest.param(
            "import polars as pl",
            [f"x = pl.Series({x})" for x in [[], [3], [3, 3], ["3"]]],
        ),
        (
            "import pandas as pd",
            [
                f"x = pd.DataFrame({x})"
                for x in [
                    {"a": []},
                    {"a": [3]},
                    {"a": ["3"]},
                    {"a": [3], "b": [3]},
                ]
            ],
        ),
        (
            "import polars as pl",
            [
                f"x = pl.DataFrame({x})"
                for x in [
                    {"a": []},
                    {"a": [3]},
                    {"a": ["3"]},
                    {"a": [3], "b": [3]},
                ]
            ],
        ),
        # Nested mutable types
        ("", ["x = [{}]", "x[0]['a'] = 0"]),
        ("", ["x = {'a': []}", "x['a'].append(0)"]),
    ],
)
def test_change_detection(
    import_code: str,
    value_codes: List[str],
    shell: PositronShell,
    variables_comm: DummyComm,
) -> None:
    """
    Test change detection when updating the value of the same name.
    """
    _import_library(shell, import_code)
    for value_code in value_codes:
        _assert_assigned(shell, value_code, variables_comm)


def _assert_assigned(shell: PositronShell, value_code: str, variables_comm: DummyComm):
    # Test that the expected `update` message was sent with the
    # expected `assigned` value.
    with patch("positron_ipykernel.variables.timestamp", return_value=0):
        # Remember if the user namespace had the 'x' value before the assignment.
        was_empty = "x" not in shell.user_ns

        # Assign the value to a variable.
        shell.run_cell(value_code)

        # Get the summary of the variable.
        assigned = []
        unevaluated = []
        summary = not_none(_summarize_variable("x", shell.user_ns["x"])).dict()

        # Get an inspector for the variable to determine if the variable is
        # mutable or if the comparison cost is high. In either case the
        # variable should be marked as unevaluated.
        ins = get_inspector(shell.user_ns["x"])
        copiable = False
        try:
            ins.deepcopy()
            copiable = True
        except Exception:
            pass
        if (
            (not was_empty)
            & (ins.is_mutable())
            & ((not copiable) | (ins.get_comparison_cost() > 1000))
        ):
            unevaluated.append(summary)
        else:
            assigned.append(summary)

        assert variables_comm.messages == [
            json_rpc_notification(
                "update",
                {
                    "assigned": assigned,
                    "removed": [],
                    "unevaluated": unevaluated,
                    "version": 0,
                },
            )
        ]

    # Clear messages for the next assignment.
    variables_comm.messages.clear()


def _import_library(shell: PositronShell, import_code: str):
    # Import the necessary library.
    if import_code:
        if import_code.endswith("torch"):  # temporary workaround for python 3.12
            pytest.skip()
        shell.run_cell(import_code)


def test_change_detection_over_limit(shell: PositronShell, variables_comm: DummyComm):
    _import_library(shell, "import numpy as np")

    big_array = f"x = np.arange({BIG_ARRAY_LENGTH})"
    shell.run_cell(big_array)
    variables_comm.messages.clear()

    _assert_assigned(shell, big_array, variables_comm)
    _assert_assigned(shell, big_array, variables_comm)
    _assert_assigned(shell, big_array, variables_comm)


def test_handle_refresh(shell: PositronShell, variables_comm: DummyComm) -> None:
    shell.user_ns["x"] = 3

    msg = json_rpc_request("list", comm_id="dummy_comm_id")
    with patch("positron_ipykernel.variables.timestamp", return_value=0):
        variables_comm.handle_msg(msg)

        # A list message is sent
        assert variables_comm.messages == [
            json_rpc_response(
                {
                    "variables": [
                        not_none(_summarize_variable("x", shell.user_ns["x"])).dict(),
                    ],
                    "length": 1,
                    "version": 0,
                }
            )
        ]


def test_list_1000(shell: PositronShell, variables_comm: DummyComm) -> None:
    # Create 1000 variables
    for j in range(0, 1000, 1):
        shell.user_ns["var{}".format(j)] = j

    # Request the list of variables
    msg = json_rpc_request("list", comm_id="dummy_comm_id")
    variables_comm.handle_msg(msg)

    # Assert that a message with 1000 variables is sent
    result_msg = variables_comm.messages[0]
    assert result_msg.get("data").get("result").get("length") == 1000

    # Also spot check the first and last variables
    variables = result_msg.get("data").get("result").get("variables")
    assert variables[0].get("display_name") == "var0"
    assert variables[999].get("display_name") == "var999"


def test_update_max_children_plus_one(
    shell: PositronShell, variables_comm: DummyComm, monkeypatch
) -> None:
    # Monkeypatch MAX_CHILDREN to avoid a slow test; we're still testing the logic
    max_children = 10
    monkeypatch.setattr(variables_module, "MAX_CHILDREN", max_children)

    # Create and update more than MAX_CHILDREN variables
    n = max_children + 1
    add_value = 500
    msg: Any = create_and_update_n_vars(n, add_value, shell, variables_comm)

    # Check we received an update message
    assert msg.get("data").get("method") == "update"

    # Check we did not lose any variables
    assigned = msg.get("data").get("params").get("assigned")
    assert len(assigned) == n

    # Spot check the first and last variables display values
    assert assigned[0].get("display_value") == str(add_value)
    assert assigned[n - 1].get("display_value") == str(n - 1 + add_value)


def test_update_max_items_plus_one(
    shell: PositronShell, variables_comm: DummyComm, monkeypatch
) -> None:
    # Monkeypatch MAX_ITEMS to avoid a slow test; we're still testing the logic
    max_items = 10
    monkeypatch.setattr(variables_module, "MAX_ITEMS", max_items)

    # Create and update more than MAX_ITEMS variables
    n = max_items + 1
    add_value = 500
    msg: Any = create_and_update_n_vars(n, add_value, shell, variables_comm)

    # If we exceed MAX_ITEMS, the kernel sends a refresh message instead
    assert msg.get("data").get("method") == "refresh"

    # Check we did not exceed MAX_ITEMS variables
    variables = msg.get("data").get("params").get("variables")
    variables_len = len(variables)
    assert variables_len == max_items

    # Spot check the first and last variables display values
    assert variables[0].get("display_value") == str(add_value)
    assert variables[variables_len - 1].get("display_value") == str(variables_len - 1 + add_value)


def create_and_update_n_vars(
    n: int, add_value: int, shell: PositronShell, variables_comm: DummyComm
) -> Any:
    # Create n variables
    assign_n = ""
    for j in range(0, n, 1):
        assign_n += "x{} = {}".format(j, j) + "\n"

    shell.run_cell(assign_n)
    variables_comm.messages.clear()

    # Re-assign the variables to trigger an update message
    update_n = ""
    for j in range(0, n, 1):
        update_n += "x{} = {}".format(j, j + add_value) + "\n"

    shell.run_cell(update_n)
    return variables_comm.messages[0]


@pytest.mark.asyncio
async def test_handle_clear(
    shell: PositronShell,
    variables_service: VariablesService,
    variables_comm: DummyComm,
) -> None:
    shell.user_ns.update({"x": 3, "y": 5})

    msg = json_rpc_request("clear", {"include_hidden_objects": False}, comm_id="dummy_comm_id")
    variables_comm.handle_msg(msg)

    # Wait until all resulting kernel tasks are processed
    await asyncio.gather(*variables_service._pending_tasks)

    # We should get a result
    assert variables_comm.messages == [
        json_rpc_response({}),
        json_rpc_notification(
            "update",
            {
                "assigned": [],
                "removed": [encode_access_key("x"), encode_access_key("y")],
                "unevaluated": [],
                "version": 0,
            },
        ),
        json_rpc_notification("refresh", {"length": 0, "variables": [], "version": 0}),
    ]

    # All user variables are removed
    assert "x" not in shell.user_ns
    assert "y" not in shell.user_ns


def test_handle_delete(shell: PositronShell, variables_comm: DummyComm) -> None:
    shell.user_ns.update({"x": 3, "y": 5})

    msg = json_rpc_request("delete", {"names": ["x"]}, comm_id="dummy_comm_id")
    variables_comm.handle_msg(msg)

    # Only the `x` variable is removed
    assert "x" not in shell.user_ns
    assert "y" in shell.user_ns

    assert variables_comm.messages == [
        json_rpc_response([encode_access_key("x")]),
    ]


def test_handle_delete_error(variables_comm: DummyComm) -> None:
    msg = json_rpc_request("delete", {"names": ["x"]}, comm_id="dummy_comm_id")
    variables_comm.handle_msg(msg)

    # No variables are removed, since there are no variables named `x`
    assert variables_comm.messages == [json_rpc_response([])]


def _assert_inspect(value: Any, path: List[Any], variables_comm: DummyComm) -> None:
    encoded_path = [encode_access_key(key) for key in path]
    msg = json_rpc_request(
        "inspect",
        # TODO(pyright): We shouldn't need to cast; may be a pyright bug
        cast(JsonRecord, {"path": encoded_path}),
        comm_id="dummy_comm_id",
    )

    with patch("positron_ipykernel.variables.timestamp", return_value=0):
        variables_comm.handle_msg(msg)

        assert len(variables_comm.messages) == 1

        children = _summarize_children(value)
        assert variables_comm.messages == [
            json_rpc_response(
                {
                    "children": [child.dict() for child in children],
                    "length": len(children),
                }
            )
        ]

    variables_comm.messages.clear()


class TestClass:
    x: int = 0

    @property
    def x_plus_one(self):
        raise AssertionError("Should not be evaluated")


@pytest.mark.parametrize(
    ("value_fn"),
    [
        lambda: {0: [0], "0": [1]},
        lambda: pd.DataFrame({0: [0], "0": [1]}),
        lambda: pl.DataFrame({"a": [1, 2], "b": ["3", "4"]}),
        lambda: np.array([[0, 1], [2, 3]]),
        # Inspecting large objects should not trigger update messages: https://github.com/posit-dev/positron/issues/2308.
        lambda: np.arange(BIG_ARRAY_LENGTH),
        lambda: TestClass(),
    ],
)
def test_handle_inspect(value_fn, shell: PositronShell, variables_comm: DummyComm) -> None:
    """
    Test that we can inspect root-level objects.
    """
    value = value_fn()
    shell.user_ns["x"] = value

    _assert_inspect(value, ["x"], variables_comm)


@pytest.mark.parametrize(
    ("cls", "data"),
    [
        # We should be able to inspect the children of a map/table with keys that have the same string representation.
        (dict, {0: [0], "0": [1]}),
        (pd.DataFrame, {0: [0], "0": [1]}),
        # DataFrames
        (pd.DataFrame, {"a": [1, 2], "b": ["3", "4"]}),
        (pl.DataFrame, {"a": [1, 2], "b": ["3", "4"]}),
        # Arrays
        (np.array, [[0, 1], [2, 3]]),  # 2D
    ],
)
def test_handle_inspect_2d(
    cls: Type, data: Any, shell: PositronShell, variables_comm: DummyComm
) -> None:
    """
    Test that we can inspect children of "two-dimensional" objects.
    """
    value = cls(data)
    shell.user_ns["x"] = value

    keys = data.keys() if isinstance(data, dict) else range(len(data))
    for key in keys:
        _assert_inspect(value[key], ["x", key], variables_comm)


def test_handle_inspect_error(variables_comm: DummyComm) -> None:
    path = [encode_access_key("x")]
    # TODO(pyright): We shouldn't need to cast; may be a pyright bug
    msg = json_rpc_request("inspect", cast(JsonRecord, {"path": path}), comm_id="dummy_comm_id")
    variables_comm.handle_msg(msg)

    # An error message is sent
    assert variables_comm.messages == [
        json_rpc_error(
            JsonRpcErrorCode.INVALID_PARAMS,
            f"Cannot find variable at '{path}' to inspect",
        )
    ]


def test_handle_clipboard_format(shell: PositronShell, variables_comm: DummyComm) -> None:
    shell.user_ns.update({"x": 3, "y": 5})

    msg = json_rpc_request(
        "clipboard_format",
        {
            "path": [encode_access_key("x")],
            "format": "text/plain",
        },
        comm_id="dummy_comm_id",
    )
    variables_comm.handle_msg(msg)

    assert variables_comm.messages == [json_rpc_response({"content": "3"})]


def test_handle_clipboard_format_error(variables_comm: DummyComm) -> None:
    path = [encode_access_key("x")]
    # TODO(pyright): We shouldn't need to cast; may be a pyright bug
    msg = json_rpc_request(
        "clipboard_format",
        cast(JsonRecord, {"path": path, "format": "text/plain"}),
        comm_id="dummy_comm_id",
    )
    variables_comm.handle_msg(msg)

    # An error message is sent
    assert variables_comm.messages == [
        json_rpc_error(
            JsonRpcErrorCode.INVALID_PARAMS,
            f"Cannot find variable at '{path}' to format",
        )
    ]


def test_handle_view(
    shell: PositronShell,
    variables_comm: DummyComm,
    mock_dataexplorer_service: Mock,
) -> None:
    shell.user_ns["x"] = pd.DataFrame({"a": [0]})

    msg = json_rpc_request("view", {"path": [encode_access_key("x")]}, comm_id="dummy_comm_id")
    variables_comm.handle_msg(msg)

    # An acknowledgment message is sent
    assert len(variables_comm.messages) == 1

    assert_register_table_called(mock_dataexplorer_service, shell.user_ns["x"], "x")


def test_handle_view_error(variables_comm: DummyComm) -> None:
    path = [encode_access_key("x")]
    # TODO(pyright): We shouldn't need to cast; may be a pyright bug
    msg = json_rpc_request("view", cast(JsonRecord, {"path": path}), comm_id="dummy_comm_id")
    variables_comm.handle_msg(msg)

    # An error message is sent
    assert variables_comm.messages == [
        json_rpc_error(
            JsonRpcErrorCode.INVALID_PARAMS,
            f"Cannot find variable at '{path}' to view",
        )
    ]


def test_handle_unknown_method(variables_comm: DummyComm) -> None:
    msg = json_rpc_request("unknown_method", comm_id="dummy_comm_id")
    variables_comm.handle_msg(msg)

    assert variables_comm.messages == [
        json_rpc_error(
            JsonRpcErrorCode.METHOD_NOT_FOUND,
            "Unknown method 'unknown_method'",
        )
    ]


@pytest.mark.asyncio
async def test_shutdown(variables_service: VariablesService, variables_comm: DummyComm) -> None:
    # Double-check that the comm is not yet closed
    assert not variables_comm._closed

    await variables_service.shutdown()

    # Comm is closed
    assert variables_comm._closed

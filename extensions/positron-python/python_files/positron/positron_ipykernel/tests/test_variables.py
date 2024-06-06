#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
#

from __future__ import annotations

import asyncio
from typing import Any, Dict, List, cast
from unittest.mock import ANY, Mock, patch

import numpy as np
import pandas as pd
import polars as pl
import pytest

from positron_ipykernel import variables as variables_module
from positron_ipykernel.access_keys import encode_access_key
from positron_ipykernel.inspectors import get_inspector
from positron_ipykernel.positron_comm import JsonRpcErrorCode
from positron_ipykernel.positron_ipkernel import PositronIPyKernel
from positron_ipykernel.utils import JsonData, JsonRecord, not_none
from positron_ipykernel.variables import VariablesService, _summarize_variable
from positron_ipykernel.variables_comm import Variable

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


def _do_list(variables_comm: DummyComm):
    msg = json_rpc_request("list", comm_id="dummy_comm_id")
    with patch("positron_ipykernel.variables.timestamp", return_value=0):
        variables_comm.handle_msg(msg)

    # Check the structure of the message but let the caller verify the contents.
    assert variables_comm.messages == [
        json_rpc_response(
            {
                "variables": ANY,
                "length": ANY,
                "version": 0,
            }
        )
    ]

    result = variables_comm.messages[0]["data"]["result"]
    result["variables"] = [
        Variable.parse_obj(variable)
        for variable in result["variables"]
    ]

    variables_comm.messages.clear()

    return result


def test_list(shell: PositronShell, variables_comm: DummyComm) -> None:
    shell.user_ns["x"] = 3

    result = _do_list(variables_comm)

    with patch("positron_ipykernel.variables.timestamp", return_value=0):
        expected_variables = [not_none(_summarize_variable("x", shell.user_ns["x"]))]

    assert result["length"] == 1
    assert result["variables"] == expected_variables


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


# TODO(seem): Should be typed as List[str] but that makes pyright unhappy; might be a pyright bug
def _encode_path(path: List[Any]) -> List[JsonData]:
    return [encode_access_key(key) for key in path]


@pytest.mark.asyncio
async def test_clear(
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
                "removed": _encode_path(["x", "y"]),
                "unevaluated": [],
                "version": 0,
            },
        ),
        json_rpc_notification("refresh", {"length": 0, "variables": [], "version": 0}),
    ]

    # All user variables are removed
    assert "x" not in shell.user_ns
    assert "y" not in shell.user_ns


def test_delete(shell: PositronShell, variables_comm: DummyComm) -> None:
    shell.user_ns.update({"x": 3, "y": 5})

    msg = json_rpc_request("delete", {"names": ["x"]}, comm_id="dummy_comm_id")
    variables_comm.handle_msg(msg)

    # Only the `x` variable is removed
    assert "x" not in shell.user_ns
    assert "y" in shell.user_ns

    assert variables_comm.messages == [
        json_rpc_response(_encode_path(["x"])),
    ]


def test_delete_error(variables_comm: DummyComm) -> None:
    msg = json_rpc_request("delete", {"names": ["x"]}, comm_id="dummy_comm_id")
    variables_comm.handle_msg(msg)

    # No variables are removed, since there are no variables named `x`
    assert variables_comm.messages == [json_rpc_response([])]


# TODO(seem): encoded_path should be typed as List[str] but that makes pyright unhappy; might be a pyright bug
def _do_inspect(encoded_path: List[JsonData], variables_comm: DummyComm) -> List[Variable]:
    msg = json_rpc_request(
        "inspect",
        {"path": encoded_path},
        comm_id="dummy_comm_id",
    )

    with patch("positron_ipykernel.variables.timestamp", return_value=0):
        variables_comm.handle_msg(msg)

    # Check the structure of the message but let the caller verify the contents.
    assert variables_comm.messages == [
        json_rpc_response(
            {
                "children": ANY,
                "length": ANY,
            }
        )
    ]

    children = [
        Variable.parse_obj(child)
        for child in variables_comm.messages[0]["data"]["result"]["children"]
    ]

    variables_comm.messages.clear()

    return children


class TestClass:
    x: int = 0

    @property
    def x_plus_one(self):
        raise AssertionError("Should not be evaluated")


def variable(display_name: str, display_value: str, children: List[Dict[str, Any]] = []):
    return {
        "display_name": display_name,
        "display_value": display_value,
        "children": children,
    }


@pytest.mark.parametrize(
    ("value", "expected_children"),
    [
        # DataFrames
        (
            pd.DataFrame({"a": [1, 2], "b": ["3", "4"]}),
            [
                variable(
                    "a",
                    "[2 values] pandas.Series",
                    children=[variable("0", "1"), variable("1", "2")],
                ),
                variable(
                    "b",
                    "[2 values] pandas.Series",
                    children=[variable("0", "'3'"), variable("1", "'4'")],
                ),
            ],
        ),
        (
            pl.DataFrame({"a": [1, 2], "b": ["3", "4"]}),
            [
                variable(
                    "a",
                    # TODO: Should this be "[2 values] polars.Series"?
                    "[1, 2]",
                    children=[variable("0", "1"), variable("1", "2")],
                ),
                variable(
                    "b",
                    # TODO: Should this be "[2 values] polars.Series"?
                    "['3', '4']",
                    children=[variable("0", "'3'"), variable("1", "'4'")],
                ),
            ],
        ),
        # Arrays
        (
            np.array([[0, 1], [2, 3]]),
            [
                variable(
                    "0",
                    "[0,1]",
                    children=[variable("0", "0"), variable("1", "1")],
                ),
                variable(
                    "1",
                    "[2,3]",
                    children=[variable("0", "2"), variable("1", "3")],
                ),
            ],
        ),
        # Objects
        (
            TestClass(),
            [
                variable("x", "0"),
                variable("x_plus_one", repr(TestClass.x_plus_one)),
            ],
        ),
        # Children with duplicate keys
        (
            pd.Series(range(4), index=["a", "b", "a", "b"]),
            [
                variable("a", "0"),
                variable("b", "1"),
                variable("a", "2"),
                variable("b", "3"),
            ],
        ),
        # Children with unique keys that have the same display_name
        (
            {0: 0, "0": 1},
            [
                variable("0", "0"),
                variable("0", "1"),
            ],
        ),
        (
            pd.Series({0: 0, "0": 1}),
            [
                variable("0", "0"),
                variable("0", "1"),
            ],
        ),
        (
            pd.DataFrame({0: [0], "0": [1]}),
            [
                variable(
                    "0",
                    "[1 values] pandas.Series",
                    children=[variable("0", "0")],
                ),
                variable(
                    "0",
                    "[1 values] pandas.Series",
                    children=[variable("0", "1")],
                ),
            ],
        ),
    ],
)
def test_inspect(value, expected_children, shell: PositronShell, variables_comm: DummyComm) -> None:
    shell.user_ns["x"] = value
    _verify_inspect(_encode_path(["x"]), expected_children, variables_comm)


def _verify_inspect(
    encoded_path: List[JsonData],
    expected_children: List[Dict[str, Any]],
    variables_comm: DummyComm,
) -> None:
    children = _do_inspect(encoded_path, variables_comm)

    assert len(children) == len(expected_children)

    for child, expected_child in zip(children, expected_children):
        # Check the variable's properties.
        for key, value in expected_child.items():
            # Check children separately below.
            if key == "children":
                continue

            assert getattr(child, key) == value

        if expected_child["children"]:
            # Check the variable's children by doing another inspect request using the previously
            # returned access_key. This simulates a user recursively expanding a variable's children in
            # the UI.
            _verify_inspect(
                encoded_path + [child.access_key], expected_child["children"], variables_comm
            )


def test_inspect_large_object(shell: PositronShell, variables_comm: DummyComm) -> None:
    # Inspecting large objects should not trigger update messages: https://github.com/posit-dev/positron/issues/2308.
    shell.user_ns["x"] = np.arange(BIG_ARRAY_LENGTH)

    # _do_inspect will raise an error if an update message was triggered.
    _do_inspect(_encode_path(["x"]), variables_comm)


def test_inspect_error(variables_comm: DummyComm) -> None:
    path = _encode_path(["x"])
    msg = json_rpc_request("inspect", {"path": path}, comm_id="dummy_comm_id")

    variables_comm.handle_msg(msg, raise_errors=False)

    # An error message is sent
    assert variables_comm.messages == [
        json_rpc_error(
            JsonRpcErrorCode.INVALID_PARAMS,
            f"Cannot find variable at '{path}' to inspect",
        )
    ]


def test_clipboard_format(shell: PositronShell, variables_comm: DummyComm) -> None:
    shell.user_ns.update({"x": 3, "y": 5})

    msg = json_rpc_request(
        "clipboard_format",
        {
            "path": _encode_path(["x"]),
            "format": "text/plain",
        },
        comm_id="dummy_comm_id",
    )
    variables_comm.handle_msg(msg)

    assert variables_comm.messages == [json_rpc_response({"content": "3"})]


def test_clipboard_format_error(variables_comm: DummyComm) -> None:
    path = _encode_path(["x"])
    # TODO(pyright): We shouldn't need to cast; may be a pyright bug
    msg = json_rpc_request(
        "clipboard_format",
        cast(JsonRecord, {"path": path, "format": "text/plain"}),
        comm_id="dummy_comm_id",
    )
    variables_comm.handle_msg(msg, raise_errors=False)

    # An error message is sent
    assert variables_comm.messages == [
        json_rpc_error(
            JsonRpcErrorCode.INVALID_PARAMS,
            f"Cannot find variable at '{path}' to format",
        )
    ]


def test_view(
    shell: PositronShell,
    variables_comm: DummyComm,
    mock_dataexplorer_service: Mock,
) -> None:
    shell.user_ns["x"] = pd.DataFrame({"a": [0]})

    msg = json_rpc_request("view", {"path": _encode_path(["x"])}, comm_id="dummy_comm_id")
    variables_comm.handle_msg(msg)

    # An acknowledgment message is sent
    assert len(variables_comm.messages) == 1

    assert_register_table_called(mock_dataexplorer_service, shell.user_ns["x"], "x")


def test_view_error(variables_comm: DummyComm) -> None:
    path = _encode_path(["x"])
    msg = json_rpc_request("view", {"path": path}, comm_id="dummy_comm_id")
    variables_comm.handle_msg(msg, raise_errors=False)

    # An error message is sent
    assert variables_comm.messages == [
        json_rpc_error(
            JsonRpcErrorCode.INVALID_PARAMS,
            f"Cannot find variable at '{path}' to view",
        )
    ]


def test_unknown_method(variables_comm: DummyComm) -> None:
    msg = json_rpc_request("unknown_method", comm_id="dummy_comm_id")
    variables_comm.handle_msg(msg, raise_errors=False)

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

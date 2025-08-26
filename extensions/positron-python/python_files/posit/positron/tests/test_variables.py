#
# Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

from __future__ import annotations

import asyncio
import time
from typing import TYPE_CHECKING, Any, cast
from unittest.mock import ANY, Mock

import numpy as np
import pandas as pd
import polars as pl
import pytest

from positron import variables as variables_module
from positron.access_keys import encode_access_key
from positron.positron_comm import JsonRpcErrorCode
from positron.utils import JsonData, JsonRecord, not_none
from positron.variables import VariablesService, _summarize_variable
from positron.variables_comm import Variable

from .conftest import DummyComm, PositronShell
from .utils import (
    assert_register_table_called,
    comm_open_message,
    dummy_rpc_request,
    json_rpc_error,
    json_rpc_notification,
    json_rpc_request,
    json_rpc_response,
)

if TYPE_CHECKING:
    from positron.positron_ipkernel import PositronIPyKernel

BIG_ARRAY_LENGTH = 10_000_001
TARGET_NAME = "target_name"


@pytest.fixture(autouse=True)
def _patch_variables_timestamp(monkeypatch: pytest.MonkeyPatch) -> None:
    # Patch the timestamp() function to always return 0 for deterministic tests.
    monkeypatch.setattr(variables_module, "timestamp", lambda: 0)


def test_comm_open(kernel: PositronIPyKernel) -> None:
    service = VariablesService(kernel)

    # Double-check that comm is not yet open
    assert service._comm is None  # noqa: SLF001

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
        pytest.param(
            "import numpy as np", [f" = np.array({x})" for x in [3, [3], [[3]]]], id="numpy"
        ),
        pytest.param(
            "import torch", [f" = torch.tensor({x})" for x in [3, [3], [[3]]]], id="torch"
        ),
        pytest.param(
            "import pandas as pd",
            [f" = pd.Series({x})" for x in [[], [3], [3, 3], ["3"]]],
            id="pandas_series",
        ),
        pytest.param(
            "import polars as pl",
            [f" = pl.Series({x})" for x in [[], [3], [3, 3], ["3"]]],
            id="polars_series",
        ),
        pytest.param(
            "import pandas as pd",
            [
                f" = pd.DataFrame({x})"
                for x in [
                    {"a": []},
                    {"a": [3]},
                    {"a": ["3"]},
                    {"a": [3], "b": [3]},
                ]
            ],
            id="pandas_dataframe",
        ),
        pytest.param(
            "import polars as pl",
            [
                f" = pl.DataFrame({x})"
                for x in [
                    {"a": []},
                    {"a": [3]},
                    {"a": ["3"]},
                    {"a": [3], "b": [3]},
                ]
            ],
            id="polars_dataframe",
        ),
    ],
)
@pytest.mark.parametrize("varname", ["x", "_"])
def test_update_assigned(
    import_code: str,
    value_codes: list[str],
    varname: str,
    shell: PositronShell,
    variables_comm: DummyComm,
) -> None:
    """Test change detection when updating the value of the same name."""
    _import_library(shell, import_code)

    for value_code in value_codes:
        _assert_assigned(shell, value_code, varname, variables_comm, "assigned")


@pytest.mark.parametrize(
    "value_codes",
    [
        # Overwrite with the same value.
        pytest.param([" = []", " = []"], id="mutable_overwrite"),
        # Updating elements of nested types.
        pytest.param([" = [{}]", "[0]['a'] = 0"], id="nested_mutable_list_of_dict"),
        pytest.param([" = {'a': []}", "['a'].append(0)"], id="nested_mutable_dict_of_list"),
    ],
)
@pytest.mark.parametrize("varname", ["x", "_"])
def test_update_assigned_mutable(
    value_codes: list[str],
    varname: str,
    shell: PositronShell,
    variables_comm: DummyComm,
) -> None:
    assign_code = value_codes[0]
    _assert_assigned(shell, assign_code, varname, variables_comm, "assigned")

    for value_code in value_codes[1:]:
        _assert_assigned(shell, value_code, varname, variables_comm, "unevaluated")


@pytest.mark.parametrize("varname", ["x", "_"])
def test_no_update_for_empty_cell(
    varname: str,
    shell: PositronShell,
    variables_comm: DummyComm,
) -> None:
    # Assign a value that cannot be evaluated for change detection (e.g. a mutable value),
    # since we currently send an 'unevaluated' update on every cell execution.
    # See https://github.com/posit-dev/positron/issues/4277.
    shell.run_cell(f"{varname} = []")
    variables_comm.messages.clear()

    # No messages should be sent when an empty cell is executed.
    shell.run_cell("")
    assert variables_comm.messages == []


def _assert_assigned(
    shell: PositronShell, value_code: str, varname: str, variables_comm: DummyComm, update_type: str
):
    # Run the assignment code.
    shell.run_cell(varname + value_code).raise_error()

    # Test that the expected `update` message was sent.
    assert variables_comm.messages == [update_notification(shell, **{update_type: [varname]})]

    # Clear messages for the next assignment.
    variables_comm.messages.clear()


def update_notification(
    shell: PositronShell,
    assigned: list[str] | None = None,
    unevaluated: list[str] | None = None,
    removed: list[str] | None = None,
):
    def summarize(names: list[str] | None) -> list[JsonData]:
        if names is None:
            return []
        return [
            {**not_none(_summarize_variable(name, shell.user_ns[name])).dict()} for name in names
        ]

    return json_rpc_notification(
        "update",
        {
            "assigned": summarize(assigned),
            "removed": summarize(removed),
            "unevaluated": summarize(unevaluated),
            "version": 0,
        },
    )


def _import_library(shell: PositronShell, import_code: str):
    # Import the necessary library.
    if import_code:
        if import_code.endswith("torch"):  # temporary workaround for python 3.12
            pytest.skip()
        shell.run_cell(import_code)


@pytest.mark.parametrize("varname", ["x", "_"])
def test_change_detection_over_limit(shell: PositronShell, variables_comm: DummyComm, varname: str):
    _import_library(shell, "import numpy as np")

    big_array = f" = np.arange({BIG_ARRAY_LENGTH})"
    shell.run_cell(varname + big_array)
    variables_comm.messages.clear()

    _assert_assigned(shell, big_array, varname, variables_comm, "unevaluated")
    _assert_assigned(shell, big_array, varname, variables_comm, "unevaluated")
    _assert_assigned(shell, big_array, varname, variables_comm, "unevaluated")


@pytest.mark.usefixtures("variables_comm")
def test_change_detection_run_cell_performance(shell: PositronShell) -> None:
    # Test that change detection hooks do not cause unreasonable performance overhead: https://github.com/posit-dev/positron/issues/8245

    # First, measure baseline performance without large objects.
    start_ns = time.perf_counter_ns()
    shell.run_cell("1+1").raise_error()
    baseline_ns = time.perf_counter_ns() - start_ns

    # Create a large list similar to the reproduction case.
    shell.run_cell("""
sample_dict = {"a": 1, "b": "hello world", "c": 3.14}
large_list = [sample_dict for _ in range(1_000_000)]
""").raise_error()

    # Now measure performance with large object in namespace.
    start_ns = time.perf_counter_ns()
    shell.run_cell("1+1").raise_error()
    large_object_ns = time.perf_counter_ns() - start_ns

    # The execution time should not increase dramatically.
    # NOTE: 10x isn't great performance, but this test is mainly to catch major regressions.
    slowdown_factor = large_object_ns / baseline_ns
    assert slowdown_factor < 10, (
        f"Console became {slowdown_factor:.1f}x slower with large object "
        f"(baseline: {baseline_ns / 1e6:.3f}ms, with large object: {large_object_ns / 1e6:.3f}ms)"
    )

    # Also check absolute time - should complete within 1 second.
    assert large_object_ns < 1e9, (
        f"Simple cell execution took {large_object_ns / 1e6:.3f}ms with large object in namespace"
    )


def _do_list(variables_comm: DummyComm):
    msg = json_rpc_request("list", comm_id="dummy_comm_id")
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
    result["variables"] = [Variable.parse_obj(variable) for variable in result["variables"]]

    variables_comm.messages.clear()

    return result


def test_list_1000(shell: PositronShell, variables_comm: DummyComm) -> None:
    # Create 1000 variables
    for j in range(999):
        shell.user_ns[f"var{j}"] = j
    shell.user_ns["_"] = 999

    # Request the list of variables
    msg = json_rpc_request("list", comm_id="dummy_comm_id")
    variables_comm.handle_msg(msg)

    # Assert that a message with 1000 variables is sent
    result_msg = variables_comm.messages[0]
    assert result_msg.get("data").get("result").get("length") == 1000

    # Also spot check the first and last two variables
    variables = result_msg.get("data").get("result").get("variables")
    assert variables[0].get("display_name") == "_"
    assert variables[998].get("display_name") == "var997"
    assert variables[999].get("display_name") == "var998"


@pytest.mark.parametrize("varname", ["x", "_"])
def test_list_falls_back_on_variable_error(
    shell: PositronShell, variables_comm: DummyComm, monkeypatch, varname: str
) -> None:
    """Should fall back to a basic variable summary if the inspector encounters an error (#4777)."""
    shell.user_ns[varname] = 1

    # Temporarily break the NumberInspector.
    def number_inspector(*_args, **_kwargs):
        raise Exception

    from positron.inspectors import INSPECTOR_CLASSES

    monkeypatch.setitem(INSPECTOR_CLASSES, "number", number_inspector)

    # Request the list of variables.
    list_result = _do_list(variables_comm)

    # Spot check the listed fallback variable.
    assert list_result["length"] == len(list_result["variables"]) == 1
    assert list_result["variables"][0].display_name == varname


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

    # Spot check the first and last two variables display values
    assert assigned[0].get("display_name") == "_"
    assert assigned[1].get("display_name") == "x0"
    assert assigned[-2].get("display_name") == "x8"
    assert assigned[-1].get("display_name") == "x9"


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

    # Spot check the first and last two variables display names
    assert variables[0].get("display_name") == "_"
    assert variables[1].get("display_name") == "x0"
    assert variables[-2].get("display_name") == "x7"
    assert variables[-1].get("display_name") == "x8"


def create_and_update_n_vars(
    n: int, add_value: int, shell: PositronShell, variables_comm: DummyComm
) -> Any:
    # Create n variables
    assign_n = ""
    for j in range(n - 1):
        assign_n += f"x{j} = {j}" + "\n"
    assign_n += f"_ = {n - 1}"

    shell.run_cell(assign_n)
    variables_comm.messages.clear()

    # Re-assign the variables to trigger an update message
    update_n = ""
    for j in range(n - 1):
        update_n += f"x{j} = {j + add_value}" + "\n"
    update_n += f"_ = {n - 1 + add_value}"

    shell.run_cell(update_n)
    return variables_comm.messages[0]


# TODO(seem): Should be typed as List[str] but that makes pyright unhappy; might be a pyright bug
def _encode_path(path: list[Any]) -> list[JsonData]:
    return [encode_access_key(key) for key in path]


@pytest.mark.asyncio
async def test_clear(
    shell: PositronShell,
    variables_service: VariablesService,
    variables_comm: DummyComm,
) -> None:
    shell.user_ns.update({"x": 3, "y": 5, "_": 8})

    msg = json_rpc_request("clear", {"include_hidden_objects": False}, comm_id="dummy_comm_id")
    variables_comm.handle_msg(msg)

    # Wait until all resulting kernel tasks are processed
    await asyncio.gather(*variables_service._pending_tasks)  # noqa: SLF001

    # We should get a result
    underscore = not_none(_summarize_variable("_", shell.user_ns["_"])).dict()
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
        json_rpc_notification("refresh", {"length": 1, "variables": [underscore], "version": 0}),
    ]

    # All user variables are removed
    assert "x" not in shell.user_ns
    assert "y" not in shell.user_ns

    # ...except hidden variables, because %reset -s doesn't touch those
    assert "_" in shell.user_ns


@pytest.mark.parametrize("varname", ["x", "_"])
def test_delete(shell: PositronShell, variables_comm: DummyComm, varname) -> None:
    shell.user_ns.update({"x": 3, "y": 5, "_": 8})

    msg = json_rpc_request("delete", {"names": [varname]}, comm_id="dummy_comm_id")
    variables_comm.handle_msg(msg)

    # Only the variable we wanted to delete is removed
    assert varname not in shell.user_ns
    # The other one should still be there
    assert ({"x", "_"} - {varname}).pop() in shell.user_ns
    assert "y" in shell.user_ns

    assert variables_comm.messages == [
        json_rpc_response(_encode_path([varname])),
    ]


@pytest.mark.parametrize("varname", ["x", "_"])
def test_delete_error(variables_comm: DummyComm, varname: str) -> None:
    msg = json_rpc_request("delete", {"names": [varname]}, comm_id="dummy_comm_id")
    variables_comm.handle_msg(msg)

    # No variables are removed, since there are no variables named `x` or `_`
    assert variables_comm.messages == [json_rpc_response([])]


# TODO(seem): encoded_path should be typed as List[str] but that makes pyright unhappy; might be a pyright bug
def _do_inspect(encoded_path: list[JsonData], variables_comm: DummyComm) -> list[Variable]:
    msg = json_rpc_request(
        "inspect",
        {"path": encoded_path},
        comm_id="dummy_comm_id",
    )

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


_test_obj = TestClass()


def variable(display_name: str, display_value: str, children: list[dict[str, Any]] | None = None):
    if children is None:
        children = []
    return {
        "display_name": display_name,
        "display_value": display_value,
        "children": children,
    }


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        # Series
        pytest.param(
            pd.Series([1, 2]),
            lambda varname: variable(
                varname,
                "pandas.Series [1, 2]",
                children=[variable("0", "1"), variable("1", "2")],
            ),
            id="pandas_series",
        ),
        pytest.param(
            pl.Series([1, 2]),
            lambda varname: variable(
                varname,
                "polars.Series [1, 2]",
                children=[variable("0", "1"), variable("1", "2")],
            ),
            id="polars_series",
        ),
        # DataFrames
        pytest.param(
            pd.DataFrame({"a": [1, 2], "b": ["3", "4"]}),
            lambda varname: variable(
                varname,
                "[2 rows x 2 columns] pandas.DataFrame",
                children=[
                    variable(
                        "a",
                        "pandas.Series [1, 2]",
                        children=[variable("0", "1"), variable("1", "2")],
                    ),
                    variable(
                        "b",
                        "pandas.Series ['3', '4']",
                        children=[variable("0", "'3'"), variable("1", "'4'")],
                    ),
                ],
            ),
            id="pandas_dataframe",
        ),
        pytest.param(
            pl.DataFrame({"a": [1, 2], "b": ["3", "4"]}),
            lambda varname: variable(
                varname,
                "[2 rows x 2 columns] polars.DataFrame",
                children=[
                    variable(
                        "a",
                        "polars.Series [1, 2]",
                        children=[variable("0", "1"), variable("1", "2")],
                    ),
                    variable(
                        "b",
                        "polars.Series ['3', '4']",
                        children=[variable("0", "'3'"), variable("1", "'4'")],
                    ),
                ],
            ),
            id="polars_dataframe",
        ),
        # Arrays
        pytest.param(
            np.array([[0, 1], [2, 3]]),
            lambda varname: variable(
                varname,
                "[[0,1],\n [2,3]]",
                children=[
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
            id="numpy_array",
        ),
        # Objects
        pytest.param(
            _test_obj,
            lambda varname: variable(
                varname,
                repr(_test_obj),
                children=[
                    variable("x", "0"),
                    variable("x_plus_one", repr(TestClass.x_plus_one)),
                ],
            ),
            id="object_with_property",
        ),
        # Children with duplicate keys
        pytest.param(
            pd.Series(range(4), index=["a", "b", "a", "b"]),
            lambda varname: variable(
                varname,
                "pandas.Series [0, 1, 2, 3]",
                children=[
                    variable("a", "0"),
                    variable("b", "1"),
                    variable("a", "2"),
                    variable("b", "3"),
                ],
            ),
            id="pandas_series_with_duplicate_keys",
        ),
        pytest.param(
            pd.DataFrame([range(4)], columns=["a", "b", "a", "b"]),
            lambda varname: variable(
                varname,
                "[1 rows x 4 columns] pandas.DataFrame",
                children=[
                    variable("a", "pandas.Series [0]", children=[variable("0", "0")]),
                    variable("b", "pandas.Series [1]", children=[variable("0", "1")]),
                    variable("a", "pandas.Series [2]", children=[variable("0", "2")]),
                    variable("b", "pandas.Series [3]", children=[variable("0", "3")]),
                ],
            ),
            id="pandas_dataframe_with_duplicate_keys",
        ),
        # Children with unique keys that have the same display_name
        pytest.param(
            {0: 0, "0": 1},
            lambda varname: variable(
                varname,
                "{0: 0, '0': 1}",
                children=[
                    variable("0", "0"),
                    variable("0", "1"),
                ],
            ),
            id="dict_with_duplicate_display_names",
        ),
        pytest.param(
            pd.Series({0: 0, "0": 1}),
            lambda varname: variable(
                varname,
                "pandas.Series [0, 1]",
                children=[
                    variable("0", "0"),
                    variable("0", "1"),
                ],
            ),
            id="pandas_series_with_duplicate_display_names",
        ),
        pytest.param(
            pd.DataFrame({0: [0], "0": [1]}),
            lambda varname: variable(
                varname,
                "[1 rows x 2 columns] pandas.DataFrame",
                children=[
                    variable(
                        "0",
                        "pandas.Series [0]",
                        children=[variable("0", "0")],
                    ),
                    variable(
                        "0",
                        "pandas.Series [1]",
                        children=[variable("0", "1")],
                    ),
                ],
            ),
            id="pandas_dataframe_with_duplicate_display_names",
        ),
    ],
)
@pytest.mark.parametrize("varname", ["x", "_"])
def test_list_and_recursive_inspect(
    value, expected, varname: str, shell: PositronShell, variables_comm: DummyComm
) -> None:
    """Simulate a user recursively expanding a variable's children in the UI."""
    shell.user_ns[varname] = value

    # Get the variable itself via a list request.
    list_result = _do_list(variables_comm)

    # Recursively inspect the variable's children.
    _verify_inspect([], list_result["variables"], [expected(varname)], variables_comm)


@pytest.mark.parametrize("varname", ["x", "_"])
def test_inspect_by_name(varname: str, shell: PositronShell, variables_comm: DummyComm) -> None:
    # Test inspecting a variable by name instead of encoded access key: https://github.com/posit-dev/positron/issues/8052.

    # Test against a dict with duplicate keys but differing types and values.
    shell.user_ns[varname] = {"0": 0, 0: 1}

    def verify_inspect(encoded_path: list[JsonData], expected_display_value: str) -> None:
        children = _do_inspect(encoded_path, variables_comm)
        assert len(children) == 1
        assert children[0].display_value == expected_display_value

    # Path: parent name and string child access key.
    verify_inspect([varname, encode_access_key("0")], "0")

    # Path: parent name and child name - defaults to the string key "0"
    # i.e. same as the previous case.
    verify_inspect([varname, "0"], "0")

    # Path: parent name and integer child access key.
    verify_inspect([varname, encode_access_key(0)], "1")


def _verify_inspect(
    encoded_path: list[JsonData],
    children: list[Variable],
    expected_children: list[dict[str, Any]],
    variables_comm: DummyComm,
) -> None:
    assert len(children) == len(expected_children)

    for child, expected_child in zip(children, expected_children):
        # Check the inspected variable; children are checked separately below.
        expected_child = expected_child.copy()
        expected_child_children = expected_child.pop("children")
        child_dict = child.dict(include=expected_child.keys() - {"children"})
        assert child_dict == expected_child

        if expected_child_children:
            # Check the variable's children by doing another inspect request using the previously
            # returned access_key. This simulates a user recursively expanding a variable's children in
            # the UI.
            child_path = [*encoded_path, child.access_key]
            child_children = _do_inspect(child_path, variables_comm)
            _verify_inspect(child_path, child_children, expected_child_children, variables_comm)


@pytest.mark.parametrize("varname", ["x", "_"])
def test_inspect_large_object(
    shell: PositronShell, variables_comm: DummyComm, varname: str
) -> None:
    # Inspecting large objects should not trigger update messages: https://github.com/posit-dev/positron/issues/2308.
    shell.user_ns[varname] = np.arange(BIG_ARRAY_LENGTH)

    # _do_inspect will raise an error if an update message was triggered.
    _do_inspect(_encode_path([varname]), variables_comm)


@pytest.mark.parametrize("varname", ["x", "_"])
def test_inspect_error(shell: PositronShell, variables_comm: DummyComm, varname: str) -> None:
    # Ensure that the variable doesn't exist.
    shell.user_ns.pop(varname, None)

    path = _encode_path([varname])
    msg = json_rpc_request("inspect", {"path": path}, comm_id="dummy_comm_id")

    variables_comm.handle_msg(msg, raise_errors=False)

    # An error message is sent
    assert variables_comm.messages == [
        json_rpc_error(
            JsonRpcErrorCode.INVALID_PARAMS,
            f"Cannot find variable at '{path}' to inspect",
        )
    ]


@pytest.mark.parametrize(("varname", "expected"), [("x", "3"), ("_", "8")])
def test_clipboard_format(
    shell: PositronShell, variables_comm: DummyComm, varname: str, expected: str
) -> None:
    shell.user_ns.update({"x": 3, "y": 5, "_": 8})

    msg = json_rpc_request(
        "clipboard_format",
        {
            "path": _encode_path([varname]),
            "format": "text/plain",
        },
        comm_id="dummy_comm_id",
    )
    variables_comm.handle_msg(msg)

    assert variables_comm.messages == [json_rpc_response({"content": expected})]


@pytest.mark.parametrize("varname", ["x", "_"])
def test_clipboard_format_error(
    shell: PositronShell, variables_comm: DummyComm, varname: str
) -> None:
    # Ensure that the variable doesn't exist.
    shell.user_ns.pop(varname, None)

    path = _encode_path([varname])
    # TODO(pyright): We shouldn't need to cast; may be a pyright bug
    msg = json_rpc_request(
        "clipboard_format",
        cast("JsonRecord", {"path": path, "format": "text/plain"}),
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


def _do_view(
    name: str,
    shell: PositronShell,
    variables_comm: DummyComm,
    mock_dataexplorer_service: Mock,
):
    path = _encode_path([name])
    msg = dummy_rpc_request("view", {"path": path})
    variables_comm.handle_msg(msg)

    # An acknowledgment message is sent
    assert len(variables_comm.messages) == 1

    variable_path = [encode_access_key(name)]
    assert_register_table_called(
        mock_dataexplorer_service, shell.user_ns[name], name, variable_path
    )


@pytest.mark.parametrize("varname", ["dfx", "_"])
def test_view(
    shell: PositronShell, variables_comm: DummyComm, mock_dataexplorer_service: Mock, varname: str
) -> None:
    shell.user_ns[varname] = pd.DataFrame({"a": [0]})

    _do_view(varname, shell, variables_comm, mock_dataexplorer_service)


@pytest.mark.parametrize("varname", ["dfx", "_"])
def test_view_with_sqlalchemy_v1_3(
    shell: PositronShell,
    variables_comm: DummyComm,
    mock_dataexplorer_service: Mock,
    monkeypatch,
    varname: str,
) -> None:
    # Simulate sqlalchemy<=1.3 where `sqlalchemy.Engine` does not exist.
    import sqlalchemy

    monkeypatch.delattr(sqlalchemy, "Engine")

    # The view request should still work.
    shell.user_ns[varname] = pd.DataFrame({"a": [0]})

    _do_view(varname, shell, variables_comm, mock_dataexplorer_service)


@pytest.mark.parametrize("varname", ["x", "_"])
def test_view_error(shell: PositronShell, variables_comm: DummyComm, varname: str) -> None:
    # Ensure that the variable doesn't exist.
    shell.user_ns.pop(varname, None)

    path = _encode_path([varname])
    msg = json_rpc_request("view", {"path": path}, comm_id="dummy_comm_id")
    variables_comm.handle_msg(msg, raise_errors=False)

    # An error message is sent
    assert variables_comm.messages == [
        json_rpc_error(
            JsonRpcErrorCode.INVALID_PARAMS,
            f"Cannot find variable at '{path}' to view",
        )
    ]


@pytest.mark.parametrize("varname", ["x", "_"])
def test_view_error_when_pandas_not_loaded(
    shell: PositronShell, variables_comm: DummyComm, mock_dataexplorer_service: Mock, varname: str
) -> None:
    # regression test for https://github.com/posit-dev/positron/issues/3653
    shell.user_ns[varname] = pd.DataFrame({"a": [0]})

    # Cases where the object has a viewer action, but no service reports it as
    # supported.
    def not_supported(_value):
        return False

    mock_dataexplorer_service.is_supported = not_supported

    path = _encode_path([varname])
    msg = json_rpc_request("view", {"path": path}, comm_id="dummy_comm_id")
    variables_comm.handle_msg(msg, raise_errors=False)

    assert variables_comm.messages == [
        json_rpc_error(
            JsonRpcErrorCode.INTERNAL_ERROR,
            f"Error opening viewer for variable at '{path}'. Object not supported. Try restarting the session.",
        )
    ]

    # Case where the object has a viewer, but somehting wrong happens when checking
    # if the object is supported.
    def fail_is_supported(_value):
        raise TypeError("Not supported")

    mock_dataexplorer_service.is_supported = fail_is_supported
    variables_comm.handle_msg(msg, raise_errors=False)

    assert [variables_comm.messages[-1]] == [
        json_rpc_error(
            JsonRpcErrorCode.INTERNAL_ERROR,
            f"Error opening viewer for variable at '{path}'. Try restarting the session.",
        )
    ]


def _assign_variables(shell: PositronShell, variables_comm: DummyComm, **variables):
    # A hack to make sure that change events are fired when we
    # manipulate user_ns
    shell.kernel.variables_service.snapshot_user_ns()
    shell.user_ns.update(**variables)
    shell.kernel.variables_service.poll_variables()
    variables_comm.messages.clear()


def test_query_table_summary(shell: PositronShell, variables_comm: DummyComm):
    from .test_data_explorer import SIMPLE_PANDAS_DF

    _assign_variables(shell, variables_comm, df=SIMPLE_PANDAS_DF.iloc[:, :2])

    msg = json_rpc_request(
        "query_table_summary",
        {"path": ["df"], "query_types": ["summary_stats"]},
        comm_id="dummy_comm_id",
    )
    variables_comm.handle_msg(msg)

    assert variables_comm.messages == [
        json_rpc_response(
            {
                "num_rows": 5,
                "num_columns": 2,
                "column_schemas": [
                    '{"column_name": "a", "column_label": null, "column_index": 0, "type_name": "int64", "type_display": "number", "description": null, "children": null, "precision": null, "scale": null, "timezone": null, "type_size": null}',
                    '{"column_name": "b", "column_label": null, "column_index": 1, "type_name": "bool", "type_display": "boolean", "description": null, "children": null, "precision": null, "scale": null, "timezone": null, "type_size": null}',
                ],
                "column_profiles": [
                    '{"column_name": "a", "type_display": "number", "summary_stats": {"type_display": "number", "number_stats": {"min_value": "1.0000", "max_value": "5.0000", "mean": "3.0000", "median": "3.0000", "stdev": "1.5811"}, "string_stats": null, "boolean_stats": null, "date_stats": null, "datetime_stats": null, "other_stats": null}}',
                    '{"column_name": "b", "type_display": "boolean", "summary_stats": {"type_display": "boolean", "number_stats": null, "string_stats": null, "boolean_stats": {"true_count": 3, "false_count": 1}, "date_stats": null, "datetime_stats": null, "other_stats": null}}',
                ],
            }
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
    assert not variables_comm._closed  # noqa: SLF001

    await variables_service.shutdown()

    # Comm is closed
    assert variables_comm._closed  # noqa: SLF001

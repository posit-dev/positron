#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

# ruff: noqa: E712

import inspect
import math
import pprint
from datetime import datetime
from decimal import Decimal
from io import StringIO
from typing import Any, Dict, List, Optional, Type, cast

import numpy as np
import pandas as pd
import polars as pl
import pytest
import pytz

from .._vendor.pydantic import BaseModel
from ..access_keys import encode_access_key
from ..data_explorer import (
    _VALUE_INF,
    _VALUE_NA,
    _VALUE_NAN,
    _VALUE_NAT,
    _VALUE_NEGINF,
    _VALUE_NONE,
    _VALUE_NULL,
    COMPARE_OPS,
    PANDAS_INFER_DTYPE_SIZE_LIMIT,
    SCHEMA_CACHE_THRESHOLD,
    DataExplorerService,
    DataExplorerState,
    PandasView,
    _get_float_formatter,
)
from ..data_explorer_comm import (
    ColumnDisplayType,
    ColumnProfileResult,
    ColumnProfileTypeSupportStatus,
    ColumnSchema,
    ColumnSortKey,
    FilterResult,
    FormatOptions,
    RowFilter,
    RowFilterTypeSupportStatus,
    SupportStatus,
)
from ..utils import guid
from .conftest import DummyComm, PositronShell
from .test_variables import BIG_ARRAY_LENGTH
from .utils import json_rpc_notification, json_rpc_request

TARGET_NAME = "positron.dataExplorer"


def supports_keyword(func, keyword):
    signature = inspect.signature(func)
    return keyword in signature.parameters


# ----------------------------------------------------------------------
# pytest fixtures


def get_new_comm(
    de_service: DataExplorerService,
    table: Any,
    title: str,
    comm_id: Optional[str] = None,
) -> DummyComm:
    """

    A comm corresponding to a test dataset belonging to the Positron
    dataviewer service.
    """
    if comm_id is None:
        comm_id = guid()
    de_service.register_table(table, title, comm_id=comm_id)

    # Clear any existing messages
    new_comm = cast(DummyComm, de_service.comms[comm_id])
    new_comm.messages.clear()
    return new_comm


def get_last_message(de_service: DataExplorerService, comm_id: str):
    comm = cast(DummyComm, de_service.comms[comm_id].comm)
    return comm.messages[-1]


# ----------------------------------------------------------------------
# Test basic service functionality


class MyData:
    def __init__(self, value):
        self.value = value

    def __str__(self):
        return str(self.value)

    def __repr__(self):
        return repr(self.value)


SIMPLE_DATA = {
    "a": [1, 2, 3, 4, 5],
    "b": [True, False, True, None, True],
    "c": ["foo", "bar", None, "bar", "None"],
    "d": [0, 1.2, -4.5, 6, np.nan],
    "e": pd.to_datetime(
        [
            "2024-01-01 00:00:00",
            "2024-01-02 12:34:45",
            None,
            "2024-01-04 00:00:00",
            "2024-01-05 00:00:00",
        ]
    ),
    "f": [None, MyData(5), MyData(-1), None, None],
    "g": [True, False, True, False, True],
    "h": [np.inf, -np.inf, np.nan, 0, 0],
}

SIMPLE_PANDAS_DF = pd.DataFrame(SIMPLE_DATA)


def test_service_properties(de_service: DataExplorerService):
    assert de_service.comm_target == TARGET_NAME


def _dummy_rpc_request(*args):
    return json_rpc_request(*args, comm_id="dummy_comm_id")


def _open_viewer(variables_comm, path):
    path = [encode_access_key(p) for p in path]
    msg = _dummy_rpc_request("view", {"path": path})
    variables_comm.handle_msg(msg)
    # We should get a string back as a result, naming the ID of the viewer comm
    # that was opened
    assert len(variables_comm.messages) == 1
    assert isinstance(variables_comm.messages[0]["data"]["result"], str)
    variables_comm.messages.clear()
    return tuple(path)


def test_explorer_open_close_delete(
    shell: PositronShell,
    de_service: DataExplorerService,
    variables_comm: DummyComm,
):
    _assign_variables(
        shell,
        variables_comm,
        x=SIMPLE_PANDAS_DF,
        y={"key1": SIMPLE_PANDAS_DF, "key2": SIMPLE_PANDAS_DF},
    )

    path = _open_viewer(variables_comm, ["x"])

    paths = de_service.get_paths_for_variable("x")
    assert len(paths) == 1
    assert paths[0] == path

    comm_ids = list(de_service.path_to_comm_ids[path])
    assert len(comm_ids) == 1
    comm = de_service.comms[comm_ids[0]]

    # Simulate comm_close initiated from the front end
    comm.comm.handle_close({})

    # Check that cleanup callback worked correctly
    assert len(de_service.path_to_comm_ids[path]) == 0
    assert len(de_service.get_paths_for_variable("x")) == 0
    assert len(de_service.comms) == 0
    assert len(de_service.table_views) == 0


def _assign_variables(shell: PositronShell, variables_comm: DummyComm, **variables):
    # A hack to make sure that change events are fired when we
    # manipulate user_ns
    shell.kernel.variables_service.snapshot_user_ns()
    shell.user_ns.update(**variables)
    shell.kernel.variables_service.poll_variables()
    variables_comm.messages.clear()


def test_explorer_delete_variable(
    shell: PositronShell,
    de_service: DataExplorerService,
    variables_comm: DummyComm,
):
    _assign_variables(
        shell,
        variables_comm,
        x=SIMPLE_PANDAS_DF,
        y={"key1": SIMPLE_PANDAS_DF, "key2": SIMPLE_PANDAS_DF},
    )

    # Open multiple data viewers
    _open_viewer(variables_comm, ["x"])
    _open_viewer(variables_comm, ["x"])
    _open_viewer(variables_comm, ["y", "key1"])
    _open_viewer(variables_comm, ["y", "key2"])
    _open_viewer(variables_comm, ["y", "key2"])

    assert len(de_service.comms) == 5
    assert len(de_service.table_views) == 5
    assert len(de_service.get_paths_for_variable("x")) == 1
    assert len(de_service.get_paths_for_variable("y")) == 2

    # Delete x, check cleaned up and
    def _check_delete_variable(name):
        msg = _dummy_rpc_request("delete", {"names": [name]})

        paths = de_service.get_paths_for_variable(name)
        assert len(paths) > 0

        comms = [
            de_service.comms[comm_id] for p in paths for comm_id in de_service.path_to_comm_ids[p]
        ]
        variables_comm.handle_msg(msg)

        # Check that comms were all closed
        for comm in comms:
            last_message = cast(DummyComm, comm.comm).messages[-1]
            assert last_message["msg_type"] == "comm_close"

        for path in paths:
            assert len(de_service.path_to_comm_ids[path]) == 0

    _check_delete_variable("x")
    _check_delete_variable("y")


def _check_last_message(comm, expected_msg):
    dummy_comm = cast(DummyComm, comm.comm)
    last_message = dummy_comm.messages[-1]
    dummy_comm.messages.clear()
    assert last_message == expected_msg


def _get_last_message(comm):
    dummy_comm = cast(DummyComm, comm.comm)
    return dummy_comm.messages[-1]


def _get_comms_for_name(de_service, name):
    paths = de_service.get_paths_for_variable(name)
    assert len(paths) > 0

    return [de_service.comms[comm_id] for p in paths for comm_id in de_service.path_to_comm_ids[p]]


def _check_update_variable(de_service, name, update_type="schema"):
    comms = _get_comms_for_name(de_service, name)
    if update_type == "schema":
        expected_msg = json_rpc_notification("schema_update", {})
    else:
        expected_msg = json_rpc_notification("data_update", {})

    for comm in comms:
        _check_last_message(comm, expected_msg)


def test_register_table(de_service: DataExplorerService):
    df = pd.DataFrame({"a": [1, 2, 3, 4, 5]})
    title = "test_table"
    comm_id = guid()

    de_service.register_table(df, title, comm_id=comm_id)

    assert comm_id in de_service.comms
    table_view = de_service.table_views[comm_id]
    assert table_view.table is df
    assert table_view.state.name == title


def test_register_table_with_variable_path(de_service: DataExplorerService):
    dfvp = pd.DataFrame({"v": [9, 8, 7]})
    comm_id = guid()
    title = "test_table"
    path = ['{"type":"str","data":"dfvp"}']
    de_service.register_table(dfvp, title, variable_path=path, comm_id=comm_id)

    assert comm_id in de_service.comms
    table_view = de_service.table_views[comm_id]
    assert table_view.table is dfvp
    # Also check the Data Explorer name is the same as the title, even though a path was provided
    assert table_view.state.name == title


def test_shutdown(de_service: DataExplorerService):
    df = pd.DataFrame({"a": [1, 2, 3, 4, 5]})
    de_service.register_table(df, "t1", comm_id=guid())
    de_service.register_table(df, "t2", comm_id=guid())
    de_service.register_table(df, "t3", comm_id=guid())

    de_service.shutdown()
    assert len(de_service.comms) == 0
    assert len(de_service.table_views) == 0


# ----------------------------------------------------------------------
# Test query support for pandas DataFrame

JsonRecords = List[Dict[str, Any]]

DEFAULT_FORMAT = FormatOptions(
    large_num_digits=2,
    small_num_digits=4,
    max_integral_digits=7,
    max_value_length=1000,
    thousands_sep=",",
)


class DataExplorerFixture:
    def __init__(
        self,
        shell: PositronShell,
        de_service: DataExplorerService,
        variables_comm: DummyComm,
    ):
        self.shell = shell
        self.de_service = de_service
        self.variables_comm = variables_comm
        self.register_table("simple", SIMPLE_PANDAS_DF)
        self._table_views = {}

        shell.run_cell("import pandas as pd")
        shell.run_cell("import polars as pl")
        variables_comm.messages.clear()

    def assign_variable(self, name: str, value):
        _assign_variables(self.shell, self.variables_comm, **{name: value})

    def assign_and_open_viewer(self, table_name: str, table):
        self.assign_variable(table_name, table)
        path_df = _open_viewer(self.variables_comm, [table_name])
        comm_id = list(self.de_service.path_to_comm_ids[path_df])[0]

        return comm_id

    def execute_code(self, code: str):
        self.shell.run_cell(code)

    def register_table(self, table_name: str, table):
        comm_id = guid()

        paths = self.de_service.get_paths_for_variable(table_name)
        for path in paths:
            for old_comm_id in list(self.de_service.path_to_comm_ids[path]):
                self.de_service._close_explorer(old_comm_id)

        self.de_service.register_table(
            table,
            table_name,
            comm_id=comm_id,
            variable_path=[encode_access_key(table_name)],
        )

    def get_schema_for(self, df):
        comm_id = guid()
        self.register_table(comm_id, df)
        return self.get_schema(comm_id)

    def do_json_rpc(self, table_name, method, **params):
        paths = self.de_service.get_paths_for_variable(table_name)
        assert len(paths) == 1

        comm_id = list(self.de_service.path_to_comm_ids[paths[0]])[0]

        request = json_rpc_request(
            method,
            params=params,
            comm_id=comm_id,
        )
        self.de_service.comms[comm_id].comm.handle_msg(request)
        response = get_last_message(self.de_service, comm_id)
        data = response["data"]
        return data["result"]

    def get_schema(self, table_name, column_indices=None):
        if column_indices is None:
            column_indices = list(range(self.get_state(table_name)["table_shape"]["num_columns"]))

        return self.do_json_rpc(
            table_name,
            "get_schema",
            column_indices=column_indices,
        )["columns"]

    def search_schema(self, table_name, filters, start_index, max_results):
        return self.do_json_rpc(
            table_name,
            "search_schema",
            filters=filters,
            start_index=start_index,
            max_results=max_results,
        )

    def get_state(self, table_name):
        return self.do_json_rpc(table_name, "get_state")

    def get_data_values(self, table_name, format_options=DEFAULT_FORMAT, columns=None):
        return self.do_json_rpc(
            table_name,
            "get_data_values",
            format_options=format_options,
            columns=columns,
        )

    def get_row_labels(self, table_name, selection, format_options=DEFAULT_FORMAT):
        return self.do_json_rpc(
            table_name,
            "get_row_labels",
            format_options=format_options,
            selection=selection,
        )

    def export_data_selection(self, table_name, selection, format="csv"):
        return self.do_json_rpc(
            table_name,
            "export_data_selection",
            selection=selection,
            format=format,
        )

    def set_row_filters(self, table_name, filters=None):
        return self.do_json_rpc(table_name, "set_row_filters", filters=filters)

    def set_sort_columns(self, table_name, sort_keys=None):
        return self.do_json_rpc(table_name, "set_sort_columns", sort_keys=sort_keys)

    def get_column_profiles(self, table_name, profiles, format_options=DEFAULT_FORMAT):
        return self.do_json_rpc(
            table_name,
            "get_column_profiles",
            profiles=profiles,
            format_options=format_options,
        )

    def check_filter_case(self, table, filter_set, expected_table):
        table_id = guid()
        ex_id = guid()
        self.register_table(table_id, table)
        self.register_table(ex_id, expected_table)

        response = self.set_row_filters(table_id, filters=filter_set)
        state = self.get_state(table_id)

        ex_num_rows = len(expected_table)
        try:
            assert response == FilterResult(selected_num_rows=ex_num_rows, had_errors=False)
        except Exception:
            pprint.pprint(state["row_filters"])
            raise

        assert state["table_shape"] == {
            "num_rows": ex_num_rows,
            "num_columns": len(table.columns),
        }
        assert state["table_unfiltered_shape"] == {
            "num_rows": len(table),
            "num_columns": len(table.columns),
        }

        self.compare_tables(table_id, ex_id, table.shape)

    def check_sort_case(self, table, sort_keys, expected_table, filters=None):
        table_id = guid()
        ex_id = guid()
        ex_unsorted_id = guid()
        self.register_table(table_id, table)
        self.register_table(ex_unsorted_id, table)
        self.register_table(ex_id, expected_table)

        if filters is not None:
            self.set_row_filters(table_id, filters)
            self.set_row_filters(ex_unsorted_id, filters)

        response = self.set_sort_columns(table_id, sort_keys=sort_keys)
        assert response is None
        self.compare_tables(table_id, ex_id, table.shape)

        # Check resetting
        response = self.set_sort_columns(table_id, sort_keys=[])
        assert response is None
        self.compare_tables(table_id, ex_unsorted_id, table.shape)

    def compare_tables(self, table_id: str, expected_id: str, table_shape: tuple):
        state = self.get_state(table_id)
        ex_state = self.get_state(expected_id)

        assert state["table_shape"] == ex_state["table_shape"]

        select_all = _select_all(table_shape[0], table_shape[1])

        # Query the data and check it yields the same result as the
        # manually constructed data frame without the filter
        response = self.get_data_values(table_id, columns=select_all)
        ex_response = self.get_data_values(expected_id, columns=select_all)

        assert len(response["columns"]) == len(ex_response["columns"])
        for left, right in zip(response["columns"], ex_response["columns"]):
            left = np.array(left, dtype=object)
            right = np.array(right, dtype=object)
            mask = left == right
            different_indices = (~mask).nonzero()[0]
            if len(different_indices) > 0:
                raise AssertionError(f"Indices differ at {str(different_indices)}")


def _select_all(num_rows, num_columns):
    return [
        {
            "column_index": i,
            "spec": {
                "first_index": 0,
                "last_index": num_rows - 1,
            },
        }
        for i in range(num_columns)
    ]


@pytest.fixture
def dxf(
    shell: PositronShell,
    de_service: DataExplorerService,
    variables_comm: DummyComm,
):
    fixture = DataExplorerFixture(shell, de_service, variables_comm)
    yield fixture
    de_service.shutdown()


def _wrap_json(model: Type[BaseModel], data: JsonRecords):
    return [model(**d).dict() for d in data]


# ----------------------------------------------------------------------
# pandas backend functionality tests


def test_pandas_get_state(dxf: DataExplorerFixture):
    result = dxf.get_state("simple")
    assert result["display_name"] == "simple"
    ex_shape = {"num_rows": 5, "num_columns": 8}
    assert result["table_shape"] == ex_shape
    assert result["table_unfiltered_shape"] == ex_shape

    assert result["has_row_labels"]

    schema = dxf.get_schema("simple")

    sort_keys = [
        {"column_index": 0, "ascending": True},
        {"column_index": 1, "ascending": False},
    ]
    filters = [
        _compare_filter(schema[0], ">", 2),
        _compare_filter(schema[0], "<", 5),
    ]
    dxf.set_sort_columns("simple", sort_keys=sort_keys)
    dxf.set_row_filters("simple", filters=filters)

    result = dxf.get_state("simple")
    assert result["sort_keys"] == sort_keys

    ex_filtered_shape = {"num_rows": 2, "num_columns": 8}
    assert result["table_shape"] == ex_filtered_shape
    assert result["table_unfiltered_shape"] == ex_shape

    # Validity is checked in set_row_filters
    for f in filters:
        f["is_valid"] = True
    assert result["row_filters"] == [RowFilter(**f) for f in filters]


def test_pandas_supported_features(dxf: DataExplorerFixture):
    dxf.register_table("example", SIMPLE_PANDAS_DF)
    features = dxf.get_state("example")["supported_features"]

    search_schema = features["search_schema"]
    row_filters = features["set_row_filters"]
    column_profiles = features["get_column_profiles"]

    assert search_schema["support_status"] == SupportStatus.Supported

    column_filters = features["set_column_filters"]
    assert column_filters["support_status"] == SupportStatus.Unsupported
    assert column_filters["supported_types"] == []

    assert row_filters["support_status"] == SupportStatus.Supported
    assert row_filters["supports_conditions"] == SupportStatus.Unsupported

    row_filter_types = [
        "between",
        "compare",
        "is_empty",
        "is_false",
        "is_null",
        "is_true",
        "not_between",
        "not_empty",
        "not_null",
        "search",
        "set_membership",
    ]
    for tp in row_filter_types:
        assert (
            RowFilterTypeSupportStatus(row_filter_type=tp, support_status=SupportStatus.Supported)
            in row_filters["supported_types"]
        )
    assert len(row_filter_types) == len(row_filters["supported_types"])

    assert column_profiles["support_status"] == SupportStatus.Supported

    profile_types = [
        ColumnProfileTypeSupportStatus(
            profile_type="null_count", support_status=SupportStatus.Supported
        ),
        ColumnProfileTypeSupportStatus(
            profile_type="summary_stats",
            support_status=SupportStatus.Supported,
        ),
        ColumnProfileTypeSupportStatus(
            profile_type="histogram",
            support_status=SupportStatus.Supported,
        ),
        ColumnProfileTypeSupportStatus(
            profile_type="frequency_table",
            support_status=SupportStatus.Supported,
        ),
    ]
    for tp in profile_types:
        assert tp in column_profiles["supported_types"]


def test_pandas_get_schema(dxf: DataExplorerFixture):
    cases = [
        ([1, 2, 3, 4, 5], "int64", "number"),
        ([True, False, True, None, True], "bool", "boolean"),
        (["foo", "bar", None, "bar", "None"], "string", "string"),
        (
            np.array([0, 1.2, -4.5, 6, np.nan], dtype=np.float16),
            "float16",
            "number",
        ),
        (
            np.array([0, 1.2, -4.5, 6, np.nan], dtype=np.float32),
            "float32",
            "number",
        ),
        ([0, 1.2, -4.5, 6, np.nan], "float64", "number"),
        (
            pd.to_datetime(
                [
                    "2024-01-01 00:00:00",
                    "2024-01-02 12:34:45",
                    None,
                    "2024-01-04 00:00:00",
                    "2024-01-05 00:00:00",
                ]
            ),
            "datetime64[ns]",
            "datetime",
        ),
        ([None, MyData(5), MyData(-1), None, None], "mixed", "object"),
        (
            np.array([1 + 1j, 2 + 2j, 3 + 3j, 4 + 4j, 5 + 5j], dtype="complex64"),
            "complex64",
            "number",
        ),
        ([1 + 1j, 2 + 2j, 3 + 3j, 4 + 4j, 5 + 5j], "complex128", "number"),
        ([None] * 5, "empty", "unknown"),
    ]

    if hasattr(np, "complex256"):
        # Windows doesn't have complex256
        cases.append(
            (
                np.array(
                    [1 + 1j, 2 + 2j, 3 + 3j, 4 + 4j, 5 + 5j],
                    dtype="complex256",
                ),
                "complex256",
                "number",
            )
        )

    full_schema = [
        {
            "column_name": f"f{i}",
            "column_index": i,
            "type_name": type_name,
            "type_display": type_display,
        }
        for i, (_, type_name, type_display) in enumerate(cases)
    ]

    df = pd.DataFrame({f"f{i}": data for i, (data, _, _) in enumerate(cases)})
    dxf.register_table("full_schema", df)
    result = dxf.get_schema("full_schema", list(range(0, 100)))

    assert result == _wrap_json(ColumnSchema, full_schema)

    # Test partial schema gets, boundschecking
    result = dxf.get_schema("full_schema", list(range(2, 100)))
    assert result == _wrap_json(ColumnSchema, full_schema[2:])

    result = dxf.get_schema("simple", list(range(len(cases), 100)))
    assert result == []

    # Make a really big schema
    bigger_df = pd.concat([df] * 100, axis="columns")
    bigger_name = guid()
    bigger_schema = full_schema * 100

    # Fix the column indexes
    for i, c in enumerate(bigger_schema):
        c = c.copy()
        c["column_index"] = i
        bigger_schema[i] = c

    dxf.register_table(bigger_name, bigger_df)

    result = dxf.get_schema(bigger_name, list(range(0, 100)))
    assert result == _wrap_json(ColumnSchema, bigger_schema[:100])

    result = dxf.get_schema(bigger_name, list(range(10, 20)))
    assert result == _wrap_json(ColumnSchema, bigger_schema[10:20])


def test_pandas_get_schema_inference_limit(dxf: DataExplorerFixture):
    arr = np.array([None] * PANDAS_INFER_DTYPE_SIZE_LIMIT + ["string"])
    df = pd.DataFrame({"c0": arr})

    assert dxf.get_schema_for(df) == _wrap_json(
        ColumnSchema,
        [
            {
                "column_name": "c0",
                "column_index": 0,
                "type_name": "empty",
                "type_display": "unknown",
            }
        ],
    )


def test_pandas_series(dxf: DataExplorerFixture):
    series = SIMPLE_PANDAS_DF["a"]
    dxf.register_table("series", series)
    dxf.register_table("expected", pd.DataFrame({"a": series}))

    schema = dxf.get_schema("series")
    assert schema == _wrap_json(
        ColumnSchema,
        [
            {
                "column_name": "a",
                "column_index": 0,
                "type_name": "int64",
                "type_display": "number",
            },
        ],
    )

    dxf.compare_tables("series", "expected", (len(series), 1))

    # Test schema when name attribute is None
    series2 = series.copy()
    series2.name = None
    dxf.register_table("series2", series2)
    schema = dxf.get_schema("series2")
    assert schema == _wrap_json(
        ColumnSchema,
        [
            {
                "column_name": "unnamed",
                "column_index": 0,
                "type_name": "int64",
                "type_display": "number",
            },
        ],
    )


def test_pandas_wide_schemas(dxf: DataExplorerFixture):
    arr = np.arange(10).astype(object)

    ncols = 10000
    df = pd.DataFrame({f"col_{i}": arr for i in range(ncols)})

    dxf.register_table("wide_df", df)

    chunk_size = 100
    for chunk_index in range(ncols // chunk_size):
        start_index = chunk_index * chunk_size
        dxf.register_table(
            f"wide_df_{chunk_index}",
            df.iloc[:, start_index : (chunk_index + 1) * chunk_size],
        )

        schema_slice = dxf.get_schema("wide_df", list(range(start_index, start_index + chunk_size)))
        expected = dxf.get_schema(f"wide_df_{chunk_index}", list(range(0, chunk_size)))

        for left, right in zip(schema_slice, expected):
            right["column_index"] = right["column_index"] + start_index
            assert left == right


def _text_search_filter(term, match="contains", case_sensitive=False):
    return {
        "filter_type": "text_search",
        "params": {
            "search_type": match,
            "term": term,
            "case_sensitive": case_sensitive,
        },
    }


def _match_types_filter(data_types):
    return {
        "filter_type": "match_data_types",
        "params": {"display_types": [getattr(x, "value", x) for x in data_types]},
    }


def test_search_schema(dxf: DataExplorerFixture):
    # Test search_schema RPC for pandas and polars

    # Make a few thousand column names we can search for
    column_names = [
        f"{prefix}_{i}"
        for prefix in ["aaa", "bbb", "ccc", "ddd"]
        for i in range({"aaa": 1000, "bbb": 100, "ccc": 50, "ddd": 10}[prefix])
    ]

    data_examples = {
        0: np.arange(5),
        1: ["foo", "bar", "baz", None, "qux"],
        2: [True, False, True, False, True],
        3: [1.5, -3.4, 0, 1, 2],
        4: [
            datetime(2024, 7, 5),
            datetime(2024, 7, 6),
            None,
            datetime(2024, 7, 8),
            datetime(2024, 7, 9),
        ],
    }

    frame_data = {
        name: data_examples[i % len(data_examples)] for i, name in enumerate(column_names)
    }

    # Make a data frame with those column names
    df = pd.DataFrame(frame_data, columns=column_names)
    dfp = pl.DataFrame(frame_data, schema=column_names)

    dxf.register_table("df", df)
    dxf.register_table("dfp", dfp)

    aaa_filter = _text_search_filter("aaa")
    bbb_filter = _text_search_filter("bbb")
    ccc_filter = _text_search_filter("ccc")
    ddd_filter = _text_search_filter("ddd")

    for name in ["df", "dfp"]:
        full_schema = dxf.get_schema(name, list(range(0, len(column_names))))

        # (search_term, start_index, max_results, ex_total, ex_matches)
        cases = [
            ([aaa_filter], 0, 100, 1000, full_schema[:100]),
            (
                [aaa_filter, _match_types_filter([ColumnDisplayType.String])],
                0,
                100,
                200,
                full_schema[:500][1::5],
            ),
            (
                [
                    aaa_filter,
                    _match_types_filter([ColumnDisplayType.Boolean, ColumnDisplayType.Number]),
                ],
                0,
                120,
                600,
                [x for i, x in enumerate(full_schema[:200]) if i % 5 in (0, 2, 3)],
            ),
            ([aaa_filter], 100, 100, 1000, full_schema[100:200]),
            ([aaa_filter], 950, 100, 1000, full_schema[950:1000]),
            ([aaa_filter], 1000, 100, 1000, []),
            ([bbb_filter], 0, 10, 100, full_schema[1000:1010]),
            ([ccc_filter], 0, 10, 50, full_schema[1100:1110]),
            ([ddd_filter], 0, 10, 10, full_schema[1150:1160]),
        ]

        for (
            filters,
            start_index,
            max_results,
            ex_total,
            ex_matches,
        ) in cases:
            result = dxf.search_schema(name, filters, start_index, max_results)

            assert result["total_num_matches"] == ex_total
            matches = result["matches"]["columns"]
            assert matches == ex_matches


def test_pandas_get_data_values(dxf: DataExplorerFixture):
    # Select column range
    result = dxf.get_data_values(
        "simple",
        columns=[
            {"column_index": i, "spec": {"first_index": 0, "last_index": 20}}
            for i in list(range(8))
        ],
    )

    expected_columns = [
        ["1", "2", "3", "4", "5"],
        ["True", "False", "True", _VALUE_NONE, "True"],
        ["foo", "bar", _VALUE_NONE, "bar", "None"],
        ["0.00", "1.20", "-4.50", "6.00", _VALUE_NAN],
        [
            "2024-01-01 00:00:00",
            "2024-01-02 12:34:45",
            _VALUE_NAT,
            "2024-01-04 00:00:00",
            "2024-01-05 00:00:00",
        ],
        [_VALUE_NONE, "5", "-1", _VALUE_NONE, _VALUE_NONE],
        ["True", "False", "True", "False", "True"],
        [_VALUE_INF, _VALUE_NEGINF, _VALUE_NAN, "0.00", "0.00"],
    ]

    assert result["columns"] == expected_columns

    # Select column indices
    indices = [0, 2, 4]
    result = dxf.get_data_values(
        "simple",
        columns=[{"column_index": i, "spec": {"indices": indices}} for i in list(range(8))],
    )
    assert result["columns"] == [
        [x for i, x in enumerate(col) if i in indices] for col in expected_columns
    ]

    # Edge cases: request beyond end of table
    response = dxf.get_data_values(
        "simple",
        columns=[{"column_index": 0, "spec": {"first_index": 5, "last_index": 14}}],
    )
    assert response["columns"] == [[]]


def test_pandas_get_row_labels(dxf: DataExplorerFixture):
    result = dxf.get_row_labels("simple", {"first_index": 0, "last_index": 20})
    assert result["row_labels"] == [["0", "1", "2", "3", "4"]]

    result = dxf.get_row_labels("simple", {"indices": [0, 2, 4]})
    assert result["row_labels"] == [["0", "2", "4"]]


def _check_format_cases(dxf, table_name, cases):
    shape = dxf.get_state(table_name)["table_shape"]
    num_columns = shape["num_columns"]
    num_rows = shape["num_rows"]

    for options, expected in cases:
        result = dxf.get_data_values(
            table_name,
            columns=_select_all(num_rows, num_columns),
            format_options=options,
        )

        assert result["columns"] == expected


def test_pandas_float_formatting(dxf: DataExplorerFixture):
    df = pd.DataFrame(
        {
            "a": [
                0,
                1.0,
                1.01,
                1.012,
                0.0123,
                0.01234,
                0.0001,
                0.00001,
                9999.123,
                9999.999,
                9999999,
                10000000,
            ]
        }
    )

    dxf.register_table("df", df)

    # (FormatOptions, expected results)
    cases = [
        (
            DEFAULT_FORMAT.copy(update={"thousands_sep": ""}),
            [
                [
                    "0.00",
                    "1.00",
                    "1.01",
                    "1.01",
                    "0.0123",
                    "0.0123",
                    "0.0001",
                    "1.00E-05",
                    "9999.12",
                    "10000.00",
                    "9999999.00",
                    "1.00E+07",
                ]
            ],
        ),
        (
            DEFAULT_FORMAT.copy(update={"thousands_sep": "_", "large_num_digits": 3}),
            [
                [
                    "0.000",
                    "1.000",
                    "1.010",
                    "1.012",
                    "0.0123",
                    "0.0123",
                    "0.0001",
                    "1.000E-05",
                    "9_999.123",
                    "9_999.999",
                    "9_999_999.000",
                    "1.000E+07",
                ]
            ],
        ),
    ]

    _check_format_cases(dxf, "df", cases)


def test_get_data_values_max_value_length(dxf: DataExplorerFixture):
    df = pd.DataFrame({"a": ["a" * 100, "b" * 1000, "c" * 10000]})
    dxf.register_table("df", df)
    dfp = pl.DataFrame({"a": ["a" * 100, "b" * 1000, "c" * 10000]})
    dxf.register_table("dfp", dfp)

    # (FormatOptions, expected results)
    cases = [
        (
            DEFAULT_FORMAT.copy(update={"max_value_length": 50}),
            [
                [
                    "a" * 50,
                    "b" * 50,
                    "c" * 50,
                ]
            ],
        ),
        (
            DEFAULT_FORMAT.copy(update={"max_value_length": 1001}),
            [
                [
                    "a" * 100,
                    "b" * 1000,
                    "c" * 1001,
                ]
            ],
        ),
    ]

    # pandas
    _check_format_cases(dxf, "df", cases)

    # polars
    _check_format_cases(dxf, "dfp", cases)


def test_pandas_extension_dtypes(dxf: DataExplorerFixture):
    df = pd.DataFrame(
        {
            "datetime_tz": pd.date_range("2000-01-01", periods=5, tz="US/Eastern"),
            "arrow_bools": pd.Series([False, None, True, False, None], dtype=pd.BooleanDtype()),
            "arrow_strings": pd.Series(
                ["foo", "bar", "baz", None, "quuuux"], dtype=pd.StringDtype()
            ),
        }
    )

    dxf.assign_and_open_viewer("df", df)

    result = dxf.get_data_values("df", columns=_select_all(5, 3))

    expected_columns = [
        [
            "2000-01-01 00:00:00-05:00",
            "2000-01-02 00:00:00-05:00",
            "2000-01-03 00:00:00-05:00",
            "2000-01-04 00:00:00-05:00",
            "2000-01-05 00:00:00-05:00",
        ],
        ["False", _VALUE_NA, "True", "False", _VALUE_NA],
        ["foo", "bar", "baz", _VALUE_NA, "quuuux"],
    ]

    assert result["columns"] == expected_columns

    schema = dxf.get_schema("df")
    ex_schema = [
        {
            "column_name": "datetime_tz",
            "column_index": 0,
            "type_name": "datetime64[ns, US/Eastern]",
            "type_display": "datetime",
        },
        {
            "column_name": "arrow_bools",
            "column_index": 1,
            "type_name": "boolean",
            "type_display": "boolean",
        },
        {
            "column_name": "arrow_strings",
            "column_index": 2,
            "type_name": "string",
            "type_display": "string",
        },
    ]

    assert schema == _wrap_json(ColumnSchema, ex_schema)


def test_pandas_leading_whitespace(dxf: DataExplorerFixture):
    # See GH#3138
    df = pd.DataFrame(
        {
            "a": ["   foo", "  bar", " baz", "qux", "potato"],
            "c": [True, False, True, False, True],
        }
    )

    dxf.register_table("ws", df)
    result = dxf.get_data_values("ws", columns=_select_all(5, 2))

    expected_columns = [
        ["   foo", "  bar", " baz", "qux", "potato"],
        ["True", "False", "True", "False", "True"],
    ]

    assert result["columns"] == expected_columns


def _filter(filter_type, column_schema, condition="and", is_valid=None, **kwargs):
    kwargs.update(
        {
            "filter_id": guid(),
            "filter_type": filter_type,
            "column_schema": column_schema,
            "condition": condition,
            "is_valid": is_valid,
        }
    )
    return kwargs


def _compare_filter(column_schema, op, value, condition="and", is_valid=None):
    return _filter(
        "compare",
        column_schema,
        condition=condition,
        is_valid=is_valid,
        params={"op": op, "value": str(value)},
    )


def _between_filter(column_schema, left_value, right_value, op="between", condition="and"):
    return _filter(
        op,
        column_schema,
        condition=condition,
        params={
            "left_value": str(left_value),
            "right_value": str(right_value),
        },
    )


def _not_between_filter(column_schema, left_value, right_value, condition="and"):
    return _between_filter(
        column_schema,
        left_value,
        right_value,
        op="not_between",
        condition=condition,
    )


def _search_filter(
    column_schema,
    term,
    case_sensitive=False,
    search_type="contains",
    condition="and",
):
    return _filter(
        "search",
        column_schema,
        condition=condition,
        params={
            "search_type": search_type,
            "term": term,
            "case_sensitive": case_sensitive,
        },
    )


def _set_member_filter(
    column_schema,
    values,
    inclusive=True,
    condition="and",
):
    return _filter(
        "set_membership",
        column_schema,
        condition=condition,
        params={
            "values": [str(x) for x in values],
            "inclusive": inclusive,
        },
    )


def test_pandas_filter_between(dxf: DataExplorerFixture):
    df = SIMPLE_PANDAS_DF
    schema = dxf.get_schema("simple")

    cases = [
        (schema[0], 2, 4),  # a column
        (schema[0], 0, 2),  # d column
    ]

    for column_schema, left_value, right_value in cases:
        col = df.iloc[:, column_schema["column_index"]]

        ex_between = df[(col >= left_value) & (col <= right_value)]
        ex_not_between = df[(col < left_value) | (col > right_value)]

        dxf.check_filter_case(
            df,
            [_between_filter(column_schema, str(left_value), str(right_value))],
            ex_between,
        )
        dxf.check_filter_case(
            df,
            [_not_between_filter(column_schema, str(left_value), str(right_value))],
            ex_not_between,
        )


def test_pandas_filter_conditions(dxf: DataExplorerFixture):
    # Test AND/OR conditions when filtering
    df = SIMPLE_PANDAS_DF
    schema = dxf.get_schema("simple")

    filters = [
        _compare_filter(schema[0], ">=", 3, condition="or"),
        _compare_filter(schema[3], "<=", -4.5, condition="or"),
        # Delbierately duplicated
        _compare_filter(schema[3], "<=", -4.5, condition="or"),
    ]

    expected_df = df[(df["a"] >= 3) | (df["d"] <= -4.5)]
    dxf.check_filter_case(df, filters, expected_df)

    # Test a single condition with or set
    filters = [
        _compare_filter(schema[0], ">=", 3, condition="or"),
    ]
    dxf.check_filter_case(df, filters, df[df["a"] >= 3])


def test_pandas_filter_compare(dxf: DataExplorerFixture):
    # Just use the 'a' column to smoke test comparison filters on
    # integers
    df = SIMPLE_PANDAS_DF
    column = "a"
    schema = dxf.get_schema("simple")

    for op, op_func in COMPARE_OPS.items():
        filt = _compare_filter(schema[0], op, 3)
        expected_df = df[op_func(df[column], 3)]
        dxf.check_filter_case(df, [filt], expected_df)


def test_pandas_filter_datetimetz(dxf: DataExplorerFixture):
    tz = pytz.timezone("US/Eastern")

    df = pd.DataFrame(
        {
            "date": pd.date_range("2000-01-01", periods=5, tz="US/Eastern"),
        }
    )
    dxf.register_table("dtz", df)
    schema = dxf.get_schema("dtz")

    val = datetime(2000, 1, 3, tzinfo=tz)

    for op, op_func in COMPARE_OPS.items():
        filt = _compare_filter(schema[0], op, "2000-01-03")
        expected_df = df[op_func(df["date"], val)]
        dxf.check_filter_case(df, [filt], expected_df)


def test_pandas_filter_integer_with_float(dxf: DataExplorerFixture):
    # Test that comparing an integer column with a float value does
    # not truncate the value or error
    df = SIMPLE_PANDAS_DF
    schema = dxf.get_schema("simple")

    for op, op_func in COMPARE_OPS.items():
        filt = _compare_filter(schema[0], op, 2.5)
        expected_df = df[op_func(df["a"], 2.5)]
        dxf.check_filter_case(df, [filt], expected_df)


def test_pandas_filter_reset(dxf: DataExplorerFixture):
    table_name = "simple"
    df = SIMPLE_PANDAS_DF
    schema = dxf.get_schema("simple")

    # Test that passing empty filter set resets to unfiltered state
    filt = _compare_filter(schema[0], "<", 3)
    _ = dxf.set_row_filters(table_name, filters=[filt])
    response = dxf.set_row_filters(table_name, filters=[])
    assert response == FilterResult(selected_num_rows=len(df), had_errors=False)

    # register the whole table to make sure the filters are really cleared
    ex_id = guid()
    dxf.register_table(ex_id, df)
    dxf.compare_tables(table_name, ex_id, df.shape)


def test_pandas_polars_filter_value_coercion(dxf: DataExplorerFixture):
    data = {
        "a": [1, 2, 3, 4, 5],
        "b": pd.date_range("2000-01-01", freq="D", periods=5),
    }

    df = pd.DataFrame(data)
    pdf = pl.DataFrame(data)

    df_name = "coerce"
    pdf_name = "pcoerce"

    dxf.register_table(df_name, df)
    dxf.register_table(pdf_name, pdf)

    error_cases = [
        (1, "<", "123456789"),
        (1, "<", "2024"),
        (1, "<", "2024-01"),
        (1, "<", "2024-13-01"),
        (1, "<", "2024-01-32"),
    ]

    for name in [df_name, pdf_name]:
        schema = dxf.get_schema(name)
        for index, op, val in error_cases:
            filt = _compare_filter(schema[index], op, val)
            result = dxf.set_row_filters(name, filters=[filt])
            assert result["had_errors"]


def test_pandas_filter_is_valid(dxf: DataExplorerFixture):
    # Test AND/OR conditions when filtering
    df = SIMPLE_PANDAS_DF
    schema = dxf.get_schema("simple")

    filters = [
        _compare_filter(schema[0], ">=", 3),
        _compare_filter(schema[0], "<", 3, is_valid=False),
    ]

    expected_df = df[df["a"] >= 3]
    dxf.check_filter_case(df, filters, expected_df)

    # No filter is valid
    filters = [
        _compare_filter(schema[0], ">=", 3, is_valid=False),
        _compare_filter(schema[0], "<", 3, is_valid=False),
    ]

    dxf.check_filter_case(df, filters, df)


def test_pandas_filter_empty(dxf: DataExplorerFixture):
    df = pd.DataFrame(
        {
            "a": ["foo", "bar", "", "", "", None, "baz", ""],
            "b": [b"foo", b"bar", b"", b"", None, b"", b"baz", b""],
        }
    )

    schema = dxf.get_schema_for(df)

    dxf.check_filter_case(df, [_filter("is_empty", schema[0])], df[df["a"].str.len() == 0])
    dxf.check_filter_case(df, [_filter("not_empty", schema[0])], df[df["a"].str.len() != 0])
    dxf.check_filter_case(df, [_filter("is_empty", schema[1])], df[df["b"].str.len() == 0])
    dxf.check_filter_case(df, [_filter("not_empty", schema[1])], df[df["b"].str.len() != 0])


def test_pandas_filter_boolean(dxf: DataExplorerFixture):
    df = pd.DataFrame(
        {
            "a": [True, True, None, False, False, False, True, True],
        }
    )

    schema = dxf.get_schema_for(df)

    dxf.check_filter_case(df, [_filter("is_true", schema[0])], df[df["a"] == True])  # noqa: E712
    dxf.check_filter_case(df, [_filter("is_false", schema[0])], df[df["a"] == False])  # noqa: E712


def test_pandas_filter_is_null_not_null(dxf: DataExplorerFixture):
    df = SIMPLE_PANDAS_DF
    schema = dxf.get_schema_for(df)
    b_is_null = _filter("is_null", schema[1])
    b_not_null = _filter("not_null", schema[1])
    c_not_null = _filter("not_null", schema[2])

    cases = [
        [[b_is_null], df[df["b"].isnull()]],
        [[b_not_null], df[df["b"].notnull()]],
        [[b_not_null, c_not_null], df[df["b"].notnull() & df["c"].notnull()]],
    ]

    for filter_set, expected_df in cases:
        dxf.check_filter_case(df, filter_set, expected_df)


def test_pandas_filter_set_membership(dxf: DataExplorerFixture):
    df = SIMPLE_PANDAS_DF
    schema = dxf.get_schema_for(df)

    cases = [
        [[_set_member_filter(schema[0], [2, 4])], df[df["a"].isin([2, 4])]],
        [
            [_set_member_filter(schema[0], [2.0, 3.5, 4])],
            df[df["a"].isin([2.0, 3.5, 4])],
        ],
        [
            [_set_member_filter(schema[2], ["bar", "foo"])],
            df[df["c"].isin(["bar", "foo"])],
        ],
        [[_set_member_filter(schema[2], [])], df[df["c"].isin([])]],
        [
            [_set_member_filter(schema[2], ["bar"], False)],
            df[~df["c"].isin(["bar"])],
        ],
        [[_set_member_filter(schema[2], [], False)], df],
    ]

    for filter_set, expected_df in cases:
        dxf.check_filter_case(df, filter_set, expected_df)


def test_pandas_filter_search(dxf: DataExplorerFixture):
    df = pd.DataFrame(
        {
            "a": ["foo1", "foo2", None, "2FOO", "FOO3", "bar1", "2BAR"],
            "b": [1, 11, 31, 22, 24, 62, 89],
        }
    )

    dxf.register_table("df", df)
    schema = dxf.get_schema("df")

    # (search_type, column_schema, term, case_sensitive, boolean mask)
    cases = [
        (
            "contains",
            schema[0],
            "foo",
            False,
            df["a"].str.lower().str.contains("foo"),
        ),
        ("contains", schema[0], "foo", True, df["a"].str.contains("foo")),
        (
            "starts_with",
            schema[0],
            "foo",
            False,
            df["a"].str.lower().str.startswith("foo"),
        ),
        (
            "starts_with",
            schema[0],
            "foo",
            True,
            df["a"].str.startswith("foo"),
        ),
        (
            "ends_with",
            schema[0],
            "foo",
            False,
            df["a"].str.lower().str.endswith("foo"),
        ),
        (
            "ends_with",
            schema[0],
            "foo",
            True,
            df["a"].str.endswith("foo"),
        ),
        (
            "regex_match",
            schema[0],
            "f[o]+",
            False,
            df["a"].str.match("f[o]+", case=False),
        ),
        (
            "regex_match",
            schema[0],
            "f[o]+[^o]*",
            True,
            df["a"].str.match("f[o]+[^o]*", case=True),
        ),
    ]

    for search_type, column_schema, term, cs, mask in cases:
        mask[mask.isna()] = False
        ex_table = df[mask.astype(bool)]
        dxf.check_filter_case(
            df,
            [
                _search_filter(
                    column_schema,
                    term,
                    case_sensitive=cs,
                    search_type=search_type,
                )
            ],
            ex_table,
        )


def _replicate_df_columns(df, new_width):
    # Create a "wide" version of the data frame by replicating its
    # columns and appending an index suffix to make the column names
    # unique
    ncols = df.shape[1]
    return pd.DataFrame(
        {f"{df.columns[i % ncols]}_{i}": df.iloc[:, i % ncols] for i in range(new_width)}
    )


def test_variable_updates(
    shell: PositronShell,
    de_service: DataExplorerService,
    variables_comm: DummyComm,
    dxf: DataExplorerFixture,
):
    x = pd.DataFrame({"a": [1, 0, 3, 4]})
    x_pl = pl.DataFrame({"a": [1, 0, 3, 4]})
    big_array = np.arange(BIG_ARRAY_LENGTH)
    big_x = pd.DataFrame({"a": big_array})
    big_xpl = pl.DataFrame({"a": big_array})

    # Needs to be big enough to go over the snapshotting threshold
    arr_for_wide = np.arange(20000)
    wide_xpl = pl.DataFrame({f"f{i}": arr_for_wide for i in range(1000)})

    _assign_variables(
        shell,
        variables_comm,
        x=x,
        x_pl=x_pl,
        big_x=big_x,
        big_xpl=big_xpl,
        wide_xpl=wide_xpl,
        y={"key1": SIMPLE_PANDAS_DF, "key2": SIMPLE_PANDAS_DF},
    )

    # Check updates
    path_x = _open_viewer(variables_comm, ["x"])
    path_xpl = _open_viewer(variables_comm, ["x_pl"])
    _open_viewer(variables_comm, ["big_x"])
    _open_viewer(variables_comm, ["big_xpl"])
    _open_viewer(variables_comm, ["wide_xpl"])
    _open_viewer(variables_comm, ["y", "key1"])
    _open_viewer(variables_comm, ["y", "key2"])
    _open_viewer(variables_comm, ["y", "key2"])

    def _do_rpc(path, method, params):
        for comm_id in de_service.path_to_comm_ids[path]:
            msg = json_rpc_request(method, params=params, comm_id=comm_id)
            de_service.comms[comm_id].comm.handle_msg(msg)

    # Do a simple update and make sure that sort keys are preserved
    x_sort_keys = [{"column_index": 0, "ascending": True}]

    _do_rpc(path_x, "set_sort_columns", {"sort_keys": x_sort_keys})
    _do_rpc(path_xpl, "set_sort_columns", {"sort_keys": x_sort_keys})

    shell.run_cell("x = pd.DataFrame({'a': [1, 0, 3, 4, 5]})")
    _check_update_variable(de_service, "x", update_type="data")

    shell.run_cell("x_pl = pl.DataFrame({'a': [1, 0, 3, 4, 5]})")
    _check_update_variable(de_service, "x_pl", update_type="data")

    for name in ("x", "x_pl"):
        new_state = dxf.get_state(name)
        assert new_state["display_name"] == name
        assert new_state["table_shape"]["num_rows"] == 5
        assert new_state["table_shape"]["num_columns"] == 1
        assert new_state["sort_keys"] == [ColumnSortKey(**k) for k in x_sort_keys]

    # Execute code that triggers a schema update events for large data
    # frames
    shell.run_cell("None")
    _check_update_variable(de_service, "big_x", update_type="schema")

    # Always updates because the schema is wide
    _check_update_variable(de_service, "wide_xpl", update_type="schema")

    # Does not update because the schema was cached and is unchanged
    _check_update_variable(de_service, "big_xpl", update_type="data")

    # Update nested values in y and check for data or schema updates
    shell.run_cell(
        """y = {'key1': y['key1'].iloc[:1]],
    'key2': y['key2'].copy()}
    """
    )
    _check_update_variable(de_service, "y", update_type="data")

    shell.run_cell(
        """y = {'key1': y['key1'].iloc[:-1, :-1],
    'key2': y['key2'].copy().iloc[:, 1:]}
    """
    )
    _check_update_variable(de_service, "y", update_type="schema")


# Test a variety of state change scenarios for pandas and polars to
# make sure the updates are correct.


class SchemaChangeFixture:
    def __init__(self, dxf: DataExplorerFixture):
        self.dxf = dxf

        self.df = pd.DataFrame(
            {
                "a": [1, 2, 3, 4, 5],
                "b": ["foo", "bar", None, "baz", "qux"],
                "c": [False, True, False, True, False],
            }
        )
        self.dxf.assign_variable("df_original", self.df.copy())
        self.dxf.assign_and_open_viewer("df", self.df)

        self.dfp = pl.DataFrame(
            {
                "a": [1, 2, 3, 4, 5],
                "b": ["foo", "bar", None, "baz", "qux"],
                "c": [False, True, False, True, False],
            }
        )
        self.dxf.assign_and_open_viewer("dfp_original", self.dfp.clone())
        self.dxf.assign_and_open_viewer("dfp", self.dfp)

    def cleanup(self):
        self.dxf.de_service.shutdown()

    def check_scenario(self, table_id: str, scenario_f, code: str):
        scenario = scenario_f(self.dxf, table_id)

        filter_spec = scenario.get("filters", [])

        if "sort_keys" in scenario:
            self.dxf.set_sort_columns(table_id, sort_keys=scenario["sort_keys"])

        if len(filter_spec) > 0:
            self.dxf.set_row_filters(table_id, filters=list(zip(*filter_spec))[0])

        self.dxf.execute_code(code)

        # Get state and confirm that the right filters were made
        # invalid
        state = self.dxf.get_state(table_id)
        updated_filters = state["row_filters"]
        new_schema = self.dxf.get_schema(table_id)

        if "sort_keys" in scenario:
            assert state["sort_keys"] == scenario["updated_sort_keys"]

        for i, (spec, is_still_valid) in enumerate(filter_spec):
            assert updated_filters[i]["is_valid"] == is_still_valid

            orig_col_schema = spec["column_schema"]
            new_col_schema = None
            for c in new_schema:
                if c["column_name"] == orig_col_schema["column_name"]:
                    new_col_schema = c
                    break

            if new_col_schema is None:
                # Column deleted, check that filter is invalid
                assert not updated_filters[i]["is_valid"]
            else:
                # Check that schema was updated
                assert updated_filters[i]["column_schema"] == new_col_schema


@pytest.fixture
def ssf(dxf: DataExplorerFixture):
    fixture = SchemaChangeFixture(dxf)
    yield fixture
    fixture.cleanup()


def test_schema_change_scenario1(ssf: SchemaChangeFixture):
    # Scenario 1: convert "a" from integer to string (filter,
    # is_valid_after_change)
    def scenario1(fixture: DataExplorerFixture, table_id):
        schema = fixture.get_schema(table_id)
        return {
            "filters": [
                # is null, not null, set membership remain valid
                (_filter("is_null", schema[0]), True),
                (_filter("not_null", schema[0]), True),
                (_set_member_filter(schema[0], ["1", "2"]), True),
                # range comparison becomes invalid
                (_compare_filter(schema[0], "<", "4"), False),
                (_compare_filter(schema[0], "<=", "4"), False),
                (_compare_filter(schema[0], ">=", "4"), False),
                (_compare_filter(schema[0], ">", "4"), False),
                # equals, not-equals remain valid
                (_compare_filter(schema[0], "=", "4"), True),
                (_compare_filter(schema[0], "!=", "4"), True),
                # between, not between becomes invalid
                (_between_filter(schema[0], "1", "3"), False),
                (_not_between_filter(schema[0], "1", "3"), False),
            ]
        }

    # pandas
    ssf.check_scenario("df", scenario1, "df['a'] = df['a'].astype(str)")

    # polars
    ssf.check_scenario(
        "dfp",
        scenario1,
        "dfp = dfp.with_columns(pl.col('a').cast(pl.String))",
    )


def test_schema_change_scenario2(ssf: SchemaChangeFixture):
    # Scenario 2: convert "a" from int64 to int16
    def scenario2(fixture: DataExplorerFixture, table_id):
        schema = fixture.get_schema(table_id)
        return {
            "filters": [
                (_filter("is_null", schema[0]), True),
                (_compare_filter(schema[0], "<", "4"), True),
                (_between_filter(schema[0], "1", "3"), True),
            ]
        }

    # pandas
    ssf.check_scenario("df", scenario2, "df['a'] = df['a'].astype('int16')")

    # polars
    ssf.check_scenario("dfp", scenario2, "dfp = dfp.with_columns(pl.col('a').cast(pl.Int16))")


def test_schema_change_scenario3(ssf: SchemaChangeFixture):
    # Scenario 3: delete "a" in place
    def scenario3(fixture: DataExplorerFixture, table_id):
        schema = fixture.get_schema(table_id)
        return {
            "filters": [
                (_filter("is_null", schema[0]), False),
                (_compare_filter(schema[0], "<", "4"), False),
            ],
            "sort_keys": [{"column_index": 0, "ascending": True}],
            "updated_sort_keys": [],
        }

    # pandas
    ssf.check_scenario("df", scenario3, "del df['a']")

    # polars
    ssf.check_scenario("dfp", scenario3, "dfp = dfp.drop('a')")


def test_schema_change_scenario4(ssf: SchemaChangeFixture):
    # Scenario 4: delete "a" in a new DataFrame
    def scenario4(fixture: DataExplorerFixture, table_id):
        schema = fixture.get_schema(table_id)
        return {
            "filters": [
                (_filter("is_null", schema[0]), False),
                (_compare_filter(schema[0], "<", "4"), False),
            ]
        }

    # pandas
    ssf.check_scenario("df", scenario4, "df = df[['b']]")

    # polars
    ssf.check_scenario("dfp", scenario4, "dfp = dfp[:, ['b']]")


def test_schema_change_scenario5(ssf: SchemaChangeFixture):
    # Scenario 5: replace a column in place with a new name
    def scenario5(fixture: DataExplorerFixture, table_id):
        schema = fixture.get_schema(table_id)
        return {
            "filters": [
                (_compare_filter(schema[1], "=", "foo"), False),
            ]
        }

    # pandas
    ssf.check_scenario("df", scenario5, "df.insert(1, 'b2', df.pop('b'))")

    # polars
    ssf.check_scenario(
        "dfp",
        scenario5,
        "dfp = dfp.drop('b').insert_column(1, dfp['b'].alias('b2'))",
    )


def test_schema_change_scenario6(ssf: SchemaChangeFixture):
    # Scenario 6: add some columns, but do not disturb filters
    def scenario6(fixture: DataExplorerFixture, table_id):
        schema = fixture.get_schema(table_id)
        return {
            "filters": [
                (_compare_filter(schema[0], "=", "1"), True),
                (_compare_filter(schema[1], "=", "foo"), True),
            ]
        }

    # pandas
    ssf.check_scenario("df", scenario6, "df['b2'] = df['b']")

    # polars
    ssf.check_scenario("dfp", scenario6, "dfp = dfp.with_columns(dfp['b'].alias('b2'))")


def test_schema_change_scenario7(ssf: SchemaChangeFixture, dxf: DataExplorerFixture):
    # Scenario 7: delete column, then restore it and check that the
    def scenario7(fixture: DataExplorerFixture, table_id):
        schema = fixture.get_schema(table_id)
        return {
            "filters": [
                (_compare_filter(schema[0], "<", "4"), False),
            ]
        }

    ## pandas

    # Scenario 7 -- Validate the setup, so the filter will be invalid
    # after this
    ssf.check_scenario("df", scenario7, "del df['a']")

    # Scenario 7 -- Now restore df7 to its prior state
    dxf.execute_code("df = df_original.copy()")
    state = dxf.get_state("df")

    # Filter is made valid again because the column reappeared where
    # it was before and with a compatible type
    filt = state["row_filters"][0]
    assert filt["is_valid"]
    assert filt["error_message"] is None

    ## polars
    ssf.check_scenario("dfp", scenario7, "dfp = dfp.drop('a')")
    dxf.execute_code("dfp = dfp_original.clone()")
    state = dxf.get_state("dfp")
    filt = state["row_filters"][0]
    assert filt["is_valid"]
    assert filt["error_message"] is None


def test_schema_change_scenario8(ssf: SchemaChangeFixture):
    # Scenario 8: Delete sorted column in middle of table
    def scenario8(fixture: DataExplorerFixture, table_id):
        return {
            "sort_keys": [{"column_index": 1, "ascending": False}],
            "updated_sort_keys": [],
        }

    # pandas
    ssf.check_scenario("df", scenario8, "del df['b']")

    # polars
    ssf.check_scenario("dfp", scenario8, "dfp = dfp.drop('b')")


def test_pandas_set_sort_columns(dxf: DataExplorerFixture):
    tables = {
        "df1": SIMPLE_PANDAS_DF,
        # Just some random data to test multiple keys, different sort
        # orders, etc.
        "df2": pd.DataFrame(
            {
                "a": np.random.standard_normal(10000),
                "b": np.tile(np.arange(2), 5000),
                "c": np.tile(np.arange(10), 1000),
            }
        ),
    }
    df2_schema = dxf.get_schema_for(tables["df2"])

    cases = [
        ("df1", [(2, True)], {"by": "c"}),
        ("df1", [(2, False)], {"by": "c", "ascending": False}),
        # Tests stable sorting
        ("df2", [(1, True)], {"by": "b"}),
        ("df2", [(2, True)], {"by": "c"}),
        ("df2", [(0, True), (1, True)], {"by": ["a", "b"]}),
        (
            "df2",
            [(0, True), (1, False)],
            {"by": ["a", "b"], "ascending": [True, False]},
        ),
        (
            "df2",
            [(2, False), (1, True), (0, False)],
            {"by": ["c", "b", "a"], "ascending": [False, True, False]},
        ),
    ]

    # Test sort AND filter
    filter_cases = {"df2": [(lambda x: x[x["a"] > 0], [_compare_filter(df2_schema[0], ">", 0)])]}

    for df_name, sort_keys, expected_params in cases:
        df = tables[df_name]
        wrapped_keys = [
            {"column_index": index, "ascending": ascending} for index, ascending in sort_keys
        ]

        expected_params["kind"] = "mergesort"

        expected_df = df.sort_values(**expected_params)

        dxf.check_sort_case(df, wrapped_keys, expected_df)

        for filter_f, filters in filter_cases.get(df_name, []):
            expected_filtered = filter_f(df).sort_values(**expected_params)
            dxf.check_sort_case(df, wrapped_keys, expected_filtered, filters=filters)


def test_pandas_change_schema_after_sort(
    shell: PositronShell,
    de_service: DataExplorerService,
    variables_comm: DummyComm,
    dxf: DataExplorerFixture,
):
    df = pd.DataFrame(
        {
            "a": np.arange(10),
            "b": np.arange(10) + 1,
            "c": np.arange(10) + 2,
            "d": np.arange(10) + 3,
            "e": np.arange(10) + 4,
        }
    )
    _assign_variables(shell, variables_comm, df=df)
    _open_viewer(variables_comm, ["df"])

    # Sort a column that is out of bounds for the table after the
    # schema change below
    dxf.set_sort_columns(
        "df",
        [
            {"column_index": 4, "ascending": True},
            {"column_index": 0, "ascending": False},
        ],
    )

    expected_df = df[["b", "a"]].sort_values("a", ascending=False)  # type: ignore
    dxf.register_table("expected_df", expected_df)

    # Sort last column, and we will then change the schema
    shell.run_cell("df = df[['b', 'a']]")
    _check_update_variable(de_service, "df", update_type="schema")

    # Call get_data_values and make sure it works
    dxf.compare_tables("df", "expected_df", expected_df.shape)

    # Check that the out of bounds column index was evicted, and the
    # shift was correct
    dxf.get_state("df")["sort_keys"] = [{"column_index": 1, "ascending": False}]


def test_pandas_updated_with_sort_keys(dxf: DataExplorerFixture):
    # GitHub #3044, PandasView gets into an inconsistent state when a
    # dataset with sort keys set is updated (or the view is refreshed
    # because the dataset is large)
    arrays = [
        [1, 2, 3, 4, 5],
        [True, False, True, None, True],
        ["foo", "bar", None, "bar", "None"],
    ]
    df = pd.DataFrame({"f0": arrays[0], "f1": arrays[1], "f2": arrays[2]})

    wide_df = _replicate_df_columns(df, 10000)

    for name, table in [("df", df), ("wide_df", wide_df)]:
        comm_id = dxf.assign_and_open_viewer(name, table)
        view = dxf.de_service.table_views[comm_id]
        dxf.set_sort_columns(name, [{"column_index": 0, "ascending": False}])

        state = view.state

        new_view = PandasView(
            table,
            DataExplorerState(name, row_filters=state.row_filters, sort_keys=state.sort_keys),
        )

        schema_updated, new_state = new_view.get_updated_state(table)

        if len(table.columns) > SCHEMA_CACHE_THRESHOLD:
            # For tables with many columns, schema_updated is always true
            assert schema_updated
        else:
            assert not schema_updated

        assert new_state.row_filters == state.row_filters
        assert new_state.sort_keys == state.sort_keys


def _select_single_cell(row_index: int, col_index: int):
    return {
        "kind": "single_cell",
        "selection": {"row_index": row_index, "column_index": col_index},
    }


def _select_cell_range(
    first_row_index: int,
    last_row_index: int,
    first_col_index: int,
    last_col_index: int,
):
    return {
        "kind": "cell_range",
        "selection": {
            "first_row_index": first_row_index,
            "last_row_index": last_row_index,
            "first_column_index": first_col_index,
            "last_column_index": last_col_index,
        },
    }


def _select_range(first_index: int, last_index: int, kind: str):
    return {
        "kind": kind,
        "selection": {"first_index": first_index, "last_index": last_index},
    }


def _select_column_range(first_index: int, last_index: int):
    return _select_range(first_index, last_index, "column_range")


def _select_row_range(first_index: int, last_index: int):
    return _select_range(first_index, last_index, "row_range")


def _select_indices(indices: List[int], kind: str):
    return {
        "kind": kind,
        "selection": {"indices": indices},
    }


def _select_column_indices(indices: List[int]):
    return _select_indices(indices, "column_indices")


def _select_row_indices(indices: List[int]):
    return _select_indices(indices, "row_indices")


def test_export_data_selection(dxf: DataExplorerFixture):
    length = 100
    ncols = 20

    np.random.seed(12345)
    df = pd.DataFrame({f"a{i}": np.random.standard_normal(length) for i in range(ncols)})

    dfp = pl.DataFrame({f"a{i}": np.random.standard_normal(length) for i in range(ncols)})

    pandas_name = "df"
    polars_name = "dfp"
    dxf.register_table(pandas_name, df)
    dxf.register_table("df_filtered", df)

    dxf.register_table(polars_name, dfp)
    dxf.register_table("dfp_filtered", dfp)

    for name in ["df_filtered", "dfp_filtered"]:
        schema = dxf.get_schema(name)
        dxf.set_row_filters(name, filters=[_compare_filter(schema[0], ">", "0")])

    # Test exporting single cells
    single_cell_cases = [(0, 0), (5, 10), (25, 15), (99, 19)]

    # Test exporting ranges
    range_cases = [
        (_select_cell_range(1, 4, 10, 19), (slice(1, 5), slice(10, 20))),
        (_select_cell_range(1, 1, 4, 4), (slice(1, 2), slice(4, 5))),
        (_select_column_range(1, 5), (slice(None), slice(1, 6))),
        (_select_row_range(1, 5), (slice(1, 6), slice(None))),
        (_select_row_indices([0, 3, 5, 7]), ([0, 3, 5, 7], slice(None))),
        (_select_column_indices([0, 3, 5, 7]), (slice(None), [0, 3, 5, 7])),
    ]

    def strip_newline(x):
        if x[-1] == "\n":
            x = x[:-1]
        return x

    def pandas_export_table(x, fmt):
        buf = StringIO()
        if fmt == "csv":
            x.to_csv(buf, index=False)
        elif fmt == "tsv":
            x.to_csv(buf, sep="\t", index=False)
        elif fmt == "html":
            x.to_html(buf, index=False)
        return strip_newline(buf.getvalue())

    def pandas_export_cell(x, i, j):
        return str(x.iat[i, j])

    def pandas_iloc(x, i, j):
        return x.iloc[i, j]

    def polars_export_table(x, fmt):
        if fmt == "csv":
            return x.write_csv()
        elif fmt == "tsv":
            return x.write_csv(separator="\t")
        else:
            raise NotImplementedError(fmt)

    def polars_iloc(x, i, j):
        return x[i, j]

    def polars_export_cell(x, i, j):
        return str(x[i, j])

    data_cases = {
        ("df", pandas_export_cell, pandas_export_table, pandas_iloc),
        ("dfp", polars_export_cell, polars_export_table, polars_iloc),
    }

    data = {
        "df": (df, df[df.iloc[:, 0] > 0]),
        "dfp": (dfp, dfp.filter(dfp[:, 0] > 0)),
    }

    for name, export_cell, export_table, iloc in data_cases:
        unfiltered, filtered = data[name]
        for row_index, col_index in single_cell_cases:
            selection = _select_single_cell(row_index, col_index)
            df_result = dxf.export_data_selection(name, selection, "tsv")
            df_expected = export_cell(unfiltered, row_index, col_index)
            assert df_result["data"] == df_expected
            assert df_result["format"] == "tsv"

            filt_row_index = min(row_index, len(filtered) - 1)
            filt_selection = _select_single_cell(filt_row_index, col_index)
            filt_result = dxf.export_data_selection(f"{name}_filtered", filt_selection, "csv")
            filt_expected = export_cell(filtered, filt_row_index, col_index)
            assert filt_result["data"] == filt_expected

        for rpc_selection, selector in range_cases:
            df_selected = iloc(unfiltered, *selector)
            filtered_selected = iloc(filtered, *selector)

            for fmt in ["csv", "tsv", "html"]:
                state = dxf.get_state(name)
                features = state["supported_features"]["export_data_selection"]
                if fmt not in features["supported_formats"]:
                    continue
                df_result = dxf.export_data_selection(name, rpc_selection, fmt)
                df_expected = export_table(df_selected, fmt)

                assert df_result["data"] == df_expected
                assert df_result["format"] == fmt

                filt_result = dxf.export_data_selection(f"{name}_filtered", rpc_selection, fmt)
                filt_expected = export_table(filtered_selected, fmt)
                assert filt_result["data"] == filt_expected


def _profile_request(column_index, profiles):
    return {"column_index": column_index, "profiles": profiles}


def _get_null_count(column_index):
    return _profile_request(column_index, [{"profile_type": "null_count"}])


def _get_histogram(column_index, bins=None, method="fixed"):
    return _profile_request(
        column_index,
        [
            {
                "profile_type": "histogram",
                "params": {"histogram": {"method": method, "num_bins": bins}},
            }
        ],
    )


def _get_frequency_table(column_index, limit):
    return _profile_request(
        column_index,
        [{"profile_type": "frequency_table", "params": {"limit": limit}}],
    )


def _get_summary_stats(column_index):
    return _profile_request(column_index, [{"profile_type": "summary_stats"}])


def test_pandas_profile_null_counts(dxf: DataExplorerFixture):
    df1 = pd.DataFrame(
        {
            "a": [0, np.nan, 2, np.nan, 4, 5, 6],
            "b": ["zero", None, None, None, "four", "five", "six"],
            "c": [False, False, False, None, None, None, None],
            "d": [0, 1, 2, 3, 4, 5, 6],
        }
    )
    tables = {"df1": df1}

    for name, df in tables.items():
        dxf.register_table(name, df)

    # tuples like (table_name, [ColumnProfileRequest], [results])
    all_profiles = [
        _get_null_count(0),
        _get_null_count(1),
        _get_null_count(2),
        _get_null_count(3),
    ]
    cases = [
        ("df1", [], []),
        (
            "df1",
            [_get_null_count(3)],
            [0],
        ),
        (
            "df1",
            [
                _get_null_count(0),
                _get_null_count(1),
                _get_null_count(2),
                _get_null_count(3),
            ],
            [2, 3, 4, 0],
        ),
    ]

    for table_name, profiles, ex_results in cases:
        results = dxf.get_column_profiles(table_name, profiles)

        ex_results = [ColumnProfileResult(null_count=count) for count in ex_results]

        assert results == ex_results

    df1_schema = dxf.get_schema_for(df1)

    # Test profiling with filter
    # format: (table, filters, filtered_table, profiles)
    filter_cases = [
        (
            df1,
            [_filter("not_null", df1_schema[0])],
            df1[df1["a"].notnull()],
            all_profiles,
        )
    ]
    for table, filters, filtered_table, profiles in filter_cases:
        table_id = guid()
        dxf.register_table(table_id, table)
        dxf.set_row_filters(table_id, filters)

        filtered_id = guid()
        dxf.register_table(filtered_id, filtered_table)

        results = dxf.get_column_profiles(table_id, profiles)
        ex_results = dxf.get_column_profiles(filtered_id, profiles)

        assert results == ex_results


EPSILON = 1e-7


def _assert_close(expected, actual):
    if isinstance(expected, float) and math.isinf(expected):
        assert math.isinf(actual)
        if expected > 0:
            assert actual > 0
        else:
            assert actual < 0
    else:
        assert np.abs(actual - expected) < EPSILON


def assert_summary_stats_equal(display_type, result, ex_result):
    if display_type == ColumnDisplayType.Number:
        _assert_numeric_stats_equal(ex_result, result["number_stats"])
    elif display_type == ColumnDisplayType.String:
        _assert_string_stats_equal(ex_result, result["string_stats"])
    elif display_type == ColumnDisplayType.Boolean:
        _assert_boolean_stats_equal(ex_result, result["boolean_stats"])
    elif display_type == ColumnDisplayType.Date:
        _assert_date_stats_equal(ex_result, result["date_stats"])
    elif display_type == ColumnDisplayType.Datetime:
        _assert_datetime_stats_equal(ex_result, result["datetime_stats"])


def _assert_numeric_stats_equal(expected, actual):
    all_stats = {"min_value", "max_value", "mean", "median", "stdev"}
    for attr, value in expected.items():
        all_stats.remove(attr)
        if "j" in value:
            # Complex numbers
            _assert_close(complex(value), complex(actual.get(attr)))
        else:
            _assert_close(float(value), float(actual.get(attr)))

    # for stats that weren't expected, check that there isn't an
    # unexpected value
    for not_expected_stat in all_stats:
        assert not_expected_stat not in actual or actual[not_expected_stat] is None


def _assert_string_stats_equal(expected, actual):
    assert expected["num_empty"] == actual["num_empty"]
    assert expected["num_unique"] == actual["num_unique"]


def _assert_boolean_stats_equal(expected, actual):
    assert expected["true_count"] == actual["true_count"]
    assert expected["false_count"] == actual["false_count"]


def _assert_date_stats_equal(expected, actual):
    assert expected["num_unique"] == actual["num_unique"]
    assert expected["min_date"] == actual["min_date"]
    assert expected["mean_date"] == actual["mean_date"]
    assert expected["median_date"] == actual["median_date"]
    assert expected["max_date"] == actual["max_date"]


def _assert_datetime_stats_equal(expected, actual):
    _assert_date_stats_equal(expected, actual)
    assert expected["timezone"] == actual["timezone"]


def test_pandas_profile_summary_stats(dxf: DataExplorerFixture):
    arr = np.random.standard_normal(100)
    arr_with_nulls = arr.copy()
    arr_with_nulls[::10] = np.nan

    df1 = pd.DataFrame(
        {
            "f0": arr,
            "f1": arr_with_nulls,
            "f2": [False, False, False, True, None] * 20,
            "f3": [
                "foo",
                "",
                "baz",
                "qux",
                "foo",
                None,
                "bar",
                "",
                "bar",
                "zzz",
            ]
            * 10,
            "f4": getattr(
                pd.date_range("2000-01-01", freq="D", periods=100), "date"
            ),  # date column
            "f5": pd.date_range("2000-01-01", freq="2h", periods=100),  # datetime no tz
            "f6": pd.date_range(
                "2000-01-01", freq="2h", periods=100, tz="US/Eastern"
            ),  # datetime single tz
            "f7": [1 + 1j, 2 + 2j, 3 + 3j, 4 + 4j, np.nan] * 20,  # complex,
            "f8": [np.nan, np.inf, -np.inf, 0, np.nan] * 20,  # with infinity
            "f9": [np.nan] * 100,
        }
    )

    df_mixed_tz1 = pd.concat(
        [
            pd.DataFrame({"x": pd.date_range("2000-01-01", freq="2h", periods=50)}),
            pd.DataFrame(
                {"x": pd.date_range("2000-01-01", freq="2h", periods=50, tz="US/Eastern")}
            ),
            pd.DataFrame(
                {
                    "x": pd.date_range(
                        "2000-01-01",
                        freq="2h",
                        periods=50,
                        tz="Asia/Hong_Kong",
                    )
                }
            ),
        ]
    )

    # mixed timezones, but all datetimes are tz aware
    df_mixed_tz2 = pd.concat(
        [
            pd.DataFrame(
                {"x": pd.date_range("2000-01-01", freq="2h", periods=50, tz="US/Eastern")}
            ),
            pd.DataFrame(
                {
                    "x": pd.date_range(
                        "2000-01-01",
                        freq="2h",
                        periods=50,
                        tz="Asia/Hong_Kong",
                    )
                }
            ),
        ]
    )

    dxf.register_table("df1", df1)
    dxf.register_table("df_mixed_tz1", df_mixed_tz1)
    dxf.register_table("df_mixed_tz2", df_mixed_tz2)

    format_options = FormatOptions(
        large_num_digits=4,
        small_num_digits=6,
        max_integral_digits=7,
        max_value_length=1000,
        thousands_sep="_",
    )
    _format_float = _get_float_formatter(format_options)

    cases = [
        (
            "df1",
            0,
            {
                "min_value": _format_float(arr.min()),
                "max_value": _format_float(arr.max()),
                "mean": _format_float(df1["f0"].mean()),
                "stdev": _format_float(df1["f0"].std()),
                "median": _format_float(df1["f0"].median()),
            },
        ),
        (
            "df1",
            1,
            {
                "min_value": _format_float(df1["f1"].min()),
                "max_value": _format_float(df1["f1"].max()),
                "mean": _format_float(df1["f1"].mean()),
                "stdev": _format_float(df1["f1"].std()),
                "median": _format_float(df1["f1"].median()),
            },
        ),
        (
            "df1",
            2,
            {"true_count": 20, "false_count": 60},
        ),
        (
            "df1",
            3,
            {"num_empty": 20, "num_unique": 6},
        ),
        (
            "df1",
            4,
            {
                "num_unique": 100,
                "min_date": "2000-01-01",
                "mean_date": "2000-02-19",
                "median_date": "2000-02-19",
                "max_date": "2000-04-09",
            },
        ),
        (
            "df1",
            5,
            {
                "num_unique": 100,
                "min_date": "2000-01-01 00:00:00",
                "mean_date": "2000-01-05 03:00:00",
                "median_date": "2000-01-05 03:00:00",
                "max_date": "2000-01-09 06:00:00",
                "timezone": "None",
            },
        ),
        (
            "df1",
            6,
            {
                "num_unique": 100,
                "min_date": "2000-01-01 00:00:00-05:00",
                "mean_date": "2000-01-05 03:00:00-05:00",
                "median_date": "2000-01-05 03:00:00-05:00",
                "max_date": "2000-01-09 06:00:00-05:00",
                "timezone": "US/Eastern",
            },
        ),
        (
            "df1",
            7,
            {"mean": "2.50+2.50j", "median": "2.50+2.50j"},
        ),
        (
            "df1",
            8,
            {"min_value": "-INF", "max_value": "INF"},
        ),
        (
            "df1",
            9,
            {},
        ),
        (
            "df_mixed_tz1",
            0,
            {
                "num_unique": 150,
                "min_date": "None",
                "mean_date": "None",
                "median_date": "None",
                "max_date": "None",
                "timezone": "None, US/Eastern, ... (1 more)",
            },
        ),
        (
            "df_mixed_tz2",
            0,
            {
                "num_unique": 100,
                "min_date": "2000-01-01 00:00:00+08:00",
                "mean_date": "None",
                "median_date": "None",
                "max_date": "2000-01-05 02:00:00-05:00",
                "timezone": "US/Eastern, Asia/Hong_Kong",
            },
        ),
    ]

    for table_name, col_index, ex_result in cases:
        profiles = [_get_summary_stats(col_index)]
        results = dxf.get_column_profiles(table_name, profiles, format_options=format_options)

        stats = results[0]["summary_stats"]
        assert_summary_stats_equal(stats["type_display"], stats, ex_result)


def test_pandas_polars_profile_histogram(dxf: DataExplorerFixture):
    format_options = FormatOptions(
        large_num_digits=2,
        small_num_digits=4,
        max_integral_digits=7,
        max_value_length=1000,
        thousands_sep="_",
    )
    _format_float = _get_float_formatter(format_options)

    df = pd.DataFrame(
        {
            "a": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
            "b": pd.date_range("2000-01-01", periods=11),
            "c": [1.5, np.nan, 3.5, 5.0, 10, np.nan, 0.1, -4.3, 0, -2, -10],
            "d": [0, 0, 0, 0, 0, 10, 10, 10, 10, 10, 10],
            "e": [np.inf, -np.inf, 0, 1, 2, 3, 4, 5, 6, 7, 8],
            "f": np.ones(11),
        }
    )
    dfp = pl.DataFrame(
        {
            "a": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
            "b": list(df["b"]),
            "c": [1.5, None, 3.5, 5.0, 10, None, 0.1, -4.3, 0, -2, -10],
            "d": [0, 0, 0, 0, 0, 10, 10, 10, 10, 10, 10],
            "e": [np.inf, -np.inf, 0, 1, 2, 3, 4, 5, 6, 7, 8],
            "f": np.ones(11),
        }
    )

    dxf.register_table("df", df)
    dxf.register_table("dfp", dfp)

    cases = [
        (
            _get_histogram(0, bins=4),
            {
                "bin_edges": ["0.00", "2.50", "5.00", "7.50", "10.00"],
                "bin_counts": [3, 2, 3, 3],
                "quantiles": [],
            },
        ),
        (
            _get_histogram(1, bins=4),
            {
                "bin_edges": [
                    "2000-01-01 00:00:00",
                    "2000-01-03 12:00:00",
                    "2000-01-06 00:00:00",
                    "2000-01-08 12:00:00",
                    "2000-01-11 00:00:00",
                ],
                "bin_counts": [3, 2, 3, 3],
                "quantiles": [],
            },
        ),
        (
            _get_histogram(2, bins=6),
            {
                "bin_edges": [
                    "-10.00",
                    "-6.67",
                    "-3.33",
                    "0.00",
                    "3.33",
                    "6.67",
                    "10.00",
                ],
                "bin_counts": [1, 1, 1, 3, 2, 1],
                "quantiles": [],
            },
        ),
        (
            _get_histogram(3, bins=4),
            {
                "bin_edges": [
                    "0.00",
                    "2.50",
                    "5.00",
                    "7.50",
                    "10.00",
                ],
                "bin_counts": [5, 0, 0, 6],
                "quantiles": [],
            },
        ),
        (
            _get_histogram(4, method="sturges"),
            {
                "bin_edges": ["0.00", "1.60", "3.20", "4.80", "6.40", "8.00"],
                "bin_counts": [2, 2, 1, 2, 2],
                "quantiles": [],
            },
        ),
        (
            _get_histogram(5, method="sturges"),
            {
                "bin_edges": ["0.5000", "1.50"],
                "bin_counts": [11],
                "quantiles": [],
            },
        ),
        (
            _get_histogram(5, method="freedman_diaconis"),
            {
                "bin_edges": ["0.5000", "1.50"],
                "bin_counts": [11],
                "quantiles": [],
            },
        ),
        (
            _get_histogram(5, method="scott"),
            {
                "bin_edges": ["0.5000", "1.50"],
                "bin_counts": [11],
                "quantiles": [],
            },
        ),
        (
            _get_histogram(0, bins=50),
            {
                "bin_edges": [_format_float(x) for x in np.linspace(0.0, 10.0, 12)],
                "bin_counts": [1] * 11,
                "quantiles": [],
            },
        ),
    ]

    for name in ["df", "dfp"]:
        for profile, ex_result in cases:
            result = dxf.get_column_profiles(name, [profile])
            assert result[0]["histogram"]["histogram"] == ex_result


def test_pandas_polars_profile_frequency_table(dxf: DataExplorerFixture):
    data = {
        "a": [0, 0, 0, 1, 1, 2, 2, 3, 4, 5],
        "b": [
            "foo",
            "foo",
            "foo",
            "foo",
            "b0",
            "b0",
            "b1",
            "b2",
            "b3",
            None,
        ],
    }
    dxf.register_table("df", pd.DataFrame(data))
    dxf.register_table("dfp", pl.DataFrame(data))

    cases = [
        (
            _get_frequency_table(0, 3),
            {
                "values": ["0", "1", "2"],
                "counts": [3, 2, 2],
                "other_count": 3,
            },
        ),
        (
            _get_frequency_table(1, 3),
            {
                "values": ["foo", "b0", "b1"],
                "counts": [4, 2, 1],
                "other_count": 2,
            },
        ),
    ]

    for name in ["df", "dfp"]:
        for profile, ex_result in cases:
            result = dxf.get_column_profiles(name, [profile])
            assert result[0]["frequency_table"] == ex_result


# ----------------------------------------------------------------------
# polars backend functionality tests


POLARS_TYPE_EXAMPLES = [
    (pl.Null, [None, None, None, None], "Null", "unknown"),
    (pl.Boolean, [False, None, True, False], "Boolean", "boolean"),
    (pl.Int8, [-1, 2, 3, None], "Int8", "number"),
    (pl.Int16, [-10000, 20000, 30000, None], "Int16", "number"),
    (pl.Int32, [-10000000, 20000000, 30000000, None], "Int32", "number"),
    (
        pl.Int64,
        [-10000000000, 20000000000, 30000000000, None],
        "Int64",
        "number",
    ),
    (pl.UInt8, [0, 2, 3, None], "UInt8", "number"),
    (pl.UInt16, [0, 2000, 3000, None], "UInt16", "number"),
    (pl.UInt32, [0, 2000000, 3000000, None], "UInt32", "number"),
    (pl.UInt64, [0, 2000000000, 3000000000, None], "UInt64", "number"),
    (pl.Float32, [-0.01234, 2.56789, 3.012345, None], "Float32", "number"),
    (pl.Float64, [-0.01234, 2.56789, 3.012345, None], "Float64", "number"),
    (
        pl.Binary,
        [b"testing", b"some", b"strings", None],
        "Binary",
        "string",
    ),
    (pl.String, ["tésting", "söme", "strîngs", None], "String", "string"),
    (pl.Time, [0, 14400000000000, 40271000000000, None], "Time", "time"),
    (
        pl.Datetime("ms"),
        [1704394167126, 946730085000, 0, None],
        "Datetime(time_unit='ms', time_zone=None)",
        "datetime",
    ),
    (
        pl.Datetime("us", "America/New_York"),
        [1704394167126123, 946730085000123, 0, None],
        "Datetime(time_unit='us', time_zone='America/New_York')",
        "datetime",
    ),
    (pl.Date, [130120, 0, -1, None], "Date", "date"),
    (
        pl.Duration("ms"),
        [0, 1000, 2000, None],
        "Duration(time_unit='ms')",
        "unknown",
    ),
    (
        pl.Decimal(12, 4),
        [
            Decimal("123.4501"),
            Decimal("0.0000"),
            Decimal("12345678.4501"),
            None,
        ],
        "Decimal(precision=12, scale=4)",
        "number",
    ),
    (pl.List(pl.Int32), [[], [1, None, 3], [0], None], "List(Int32)", "array"),
    (
        pl.Struct({"a": pl.Int64, "b": pl.List(pl.String)}),
        [
            {"a": 8, "b": ["foo", None, "bar"]},
            {"a": None, "b": ["", "one", "two"]},
            None,
            {"a": 0, "b": None},
        ],
        "Struct({'a': Int64, 'b': List(String)})",
        "struct",
    ),
    # (pl.Object, ["Hello", True, None, 5], "Object", "object"),
]


def example_polars_df():
    full_schema = []
    full_data = []
    for i, (dtype, data, type_name, type_display) in enumerate(POLARS_TYPE_EXAMPLES):
        name = f"f{i}"
        s = pl.Series(name=name, values=data, dtype=dtype)
        full_data.append(s)

        # The string representation of a Decimal appears to be
        # unstable for now so we don't trust our hard-coded type_name
        # above
        if s.dtype.base_type() is pl.Decimal:
            type_name = str(s.dtype)

        full_schema.append(
            {
                "column_name": name,
                "column_index": i,
                "type_name": type_name,
                "type_display": type_display,
            }
        )

    df = pl.DataFrame(full_data)

    return df, full_schema


def test_polars_get_schema(dxf: DataExplorerFixture):
    df, full_schema = example_polars_df()
    table_name = guid()
    dxf.register_table(table_name, df)
    result = dxf.get_schema(table_name, list(range(0, len(df.columns))))

    assert result == _wrap_json(ColumnSchema, full_schema)

    # Test partial gets, boundschecking
    assert dxf.get_schema(table_name, []) == []
    assert dxf.get_schema(table_name, list(range(5, 10))) == _wrap_json(
        ColumnSchema, full_schema[5:10]
    )
    assert dxf.get_schema(table_name, list(range(5, 100))) == _wrap_json(
        ColumnSchema, full_schema[5:]
    )


def test_polars_get_state(dxf: DataExplorerFixture):
    df, _ = example_polars_df()
    name = guid()
    dxf.register_table(name, df)

    state = dxf.get_state(name)
    ex_shape = {"num_rows": df.shape[0], "num_columns": df.shape[1]}

    assert state["display_name"] == name
    assert state["table_shape"] == ex_shape
    assert state["table_unfiltered_shape"] == ex_shape
    assert state["sort_keys"] == []
    assert state["row_filters"] == []
    assert not state["has_row_labels"]

    features = state["supported_features"]
    assert features["search_schema"]["support_status"] == SupportStatus.Unsupported
    assert features["set_row_filters"]["support_status"] == SupportStatus.Supported

    column_filters = features["set_column_filters"]
    assert column_filters["support_status"] == SupportStatus.Unsupported
    assert column_filters["supported_types"] == []

    assert features["set_sort_columns"]["support_status"] == SupportStatus.Supported
    assert features["get_column_profiles"]["support_status"] == SupportStatus.Supported
    export_data = features["export_data_selection"]
    assert export_data["support_status"] == SupportStatus.Supported
    assert export_data["supported_formats"] == ["csv", "tsv"]
    assert features["get_column_profiles"]["supported_types"] == [
        ColumnProfileTypeSupportStatus(
            profile_type="null_count", support_status=SupportStatus.Supported
        ),
        ColumnProfileTypeSupportStatus(
            profile_type="summary_stats",
            support_status=SupportStatus.Supported,
        ),
    ]


def test_polars_get_data_values(dxf: DataExplorerFixture):
    df, _ = example_polars_df()
    name = guid()
    dxf.register_table(name, df)

    result = dxf.get_data_values(name, columns=_select_all(10, df.shape[1]))

    expected_columns = [
        [_VALUE_NULL] * 4,  # Null
        ["False", _VALUE_NULL, "True", "False"],  # Boolean
        ["-1", "2", "3", _VALUE_NULL],  # Int8
        ["-10000", "20000", "30000", _VALUE_NULL],  # Int16
        ["-10000000", "20000000", "30000000", _VALUE_NULL],  # Int32
        ["-10000000000", "20000000000", "30000000000", _VALUE_NULL],  # Int64
        ["0", "2", "3", _VALUE_NULL],  # UInt8
        ["0", "2000", "3000", _VALUE_NULL],  # UInt16
        ["0", "2000000", "3000000", _VALUE_NULL],  # UInt32
        ["0", "2000000000", "3000000000", _VALUE_NULL],  # UInt64
        ["-0.0123", "2.57", "3.01", _VALUE_NULL],  # Float32
        ["-0.0123", "2.57", "3.01", _VALUE_NULL],  # Float64
        ["b'testing'", "b'some'", "b'strings'", _VALUE_NULL],  # Binary
        ["tésting", "söme", "strîngs", _VALUE_NULL],  # String
        ["00:00:00", "04:00:00", "11:11:11", _VALUE_NULL],  # Time
        [
            "2024-01-04 18:49:27.126000",
            "2000-01-01 12:34:45",
            "1970-01-01 00:00:00",
            _VALUE_NULL,
        ],  # Datetime(ms)
        [
            "2024-01-04 13:49:27.126123-05:00",
            "2000-01-01 07:34:45.000123-05:00",
            "1969-12-31 19:00:00-05:00",
            _VALUE_NULL,
        ],  # Datetime(us, 'America/New_York')
        ["2326-04-05", "1970-01-01", "1969-12-31", _VALUE_NULL],  # Date
        ["0:00:00", "0:00:01", "0:00:02", _VALUE_NULL],  # Duration
        ["123.4501", "0.0000", "12345678.4501", _VALUE_NULL],  # Decimal(12, 4)
        ["[]", "[1, null, 3]", "[0]", _VALUE_NULL],  # List(Int32)
        [
            "{'a': 8, 'b': ['foo', None, 'bar']}",
            "{'a': None, 'b': ['', 'one', 'two']}",
            _VALUE_NULL,
            "{'a': 0, 'b': None}",
        ],  # Struct({'a': Int64, 'b': List(String)}),
        # ["Hello", "True", _VALUE_NULL, "5"],  # Object
    ]

    assert result["columns"] == expected_columns

    # Select column indices
    indices = [0, 1, 3]
    result = dxf.get_data_values(
        name,
        columns=[{"column_index": i, "spec": {"indices": indices}} for i in range(df.shape[1])],
    )
    assert result["columns"] == [
        [x for i, x in enumerate(col) if i in indices] for col in expected_columns
    ]

    # Select subset range
    result = dxf.get_data_values(
        name,
        columns=[
            {
                "column_index": i,
                "spec": {
                    "first_index": 2,
                    "last_index": 11,
                },
            }
            for i in range(15, df.shape[1])
        ],
    )
    assert result["columns"] == [x[2:] for x in expected_columns[15:]]

    # Empty selection
    result = dxf.get_data_values(name, columns=[])
    assert result["columns"] == []


def test_polars_filter_between(dxf: DataExplorerFixture):
    df, schema = example_polars_df()

    cases = [
        (schema[4], 0, 20000000),  # Int32 column
        (schema[2], 0, 2),  # Int8 colun
    ]

    for column_schema, left_value, right_value in cases:
        col = df[:, column_schema["column_index"]]

        ex_between = df.filter((col >= left_value) & (col <= right_value))
        ex_not_between = df.filter((col < left_value) | (col > right_value))

        dxf.check_filter_case(
            df,
            [_between_filter(column_schema, str(left_value), str(right_value))],
            ex_between,
        )
        dxf.check_filter_case(
            df,
            [_not_between_filter(column_schema, str(left_value), str(right_value))],
            ex_not_between,
        )


def test_polars_filter_compare(dxf: DataExplorerFixture):
    df, schema = example_polars_df()

    # (column_index, compare_value_str, compare_value)
    cases = [
        (2, 2, 2),  # Int8
        (2, 2.5, 2.5),  # Int8
        (4, 0, 0),  # Int32
        (4, 0.1, 0.1),  # Int32
        (11, 0, 0),  # Float64
        (15, "2000-01-01", datetime(2000, 1, 1)),  # Datetime[ms] without tz
        (
            16,
            "2000-01-01",
            datetime(2000, 1, 1, tzinfo=pytz.timezone("America/New_York")),
        ),  # Datetime[us] with tz
    ]

    for column_index, val_str, val in cases:
        for op, op_func in COMPARE_OPS.items():
            filt = _compare_filter(schema[column_index], op, val_str)
            mask = op_func(df[:, column_index], val)
            expected_df = df.filter(mask)
            dxf.check_filter_case(df, [filt], expected_df)


def test_polars_filter_is_valid_flag(dxf: DataExplorerFixture):
    # Check that invalid filters are not evaluated
    df, schema = example_polars_df()

    filters = [
        _compare_filter(schema[4], ">=", 0),
        _compare_filter(schema[4], "<", 0, is_valid=False),
    ]

    expected_df = df.filter(df["f4"] >= 3)
    dxf.check_filter_case(df, filters, expected_df)

    # No filter is valid
    filters = [
        _compare_filter(schema[4], ">=", 0, is_valid=False),
        _compare_filter(schema[0], "<", 0, is_valid=False),
    ]

    dxf.check_filter_case(df, filters, df)


def test_polars_filter_empty(dxf: DataExplorerFixture):
    df = pl.DataFrame(
        {
            "a": ["foo", "bar", "", "", "", None, "baz", ""],
            "b": [b"foo", b"bar", b"", b"", None, b"", b"baz", b""],
        }
    )

    schema = dxf.get_schema_for(df)

    dxf.check_filter_case(
        df,
        [_filter("is_empty", schema[0])],
        df.filter(df["a"].str.len_chars() == 0),
    )
    dxf.check_filter_case(
        df,
        [_filter("not_empty", schema[0])],
        df.filter(df["a"].str.len_chars() != 0),
    )
    dxf.check_filter_case(
        df,
        [_filter("is_empty", schema[1])],
        df.filter(df["b"].bin.encode("hex").str.len_chars() == 0),
    )
    dxf.check_filter_case(
        df,
        [_filter("not_empty", schema[1])],
        df.filter(df["b"].bin.encode("hex").str.len_chars() != 0),
    )


def test_polars_filter_boolean(dxf: DataExplorerFixture):
    df = pl.DataFrame(
        {
            "a": [True, True, None, False, False, False, True, True],
        }
    )

    schema = dxf.get_schema_for(df)

    dxf.check_filter_case(df, [_filter("is_true", schema[0])], df.filter(df["a"]))
    dxf.check_filter_case(df, [_filter("is_false", schema[0])], df.filter(~df["a"]))


def test_polars_filter_is_null_not_null(dxf: DataExplorerFixture):
    df, schema = example_polars_df()
    for i, col in enumerate(schema):
        dxf.check_filter_case(df, [_filter("is_null", col)], df.filter(df[:, i].is_null()))
        dxf.check_filter_case(df, [_filter("not_null", col)], df.filter(~df[:, i].is_null()))


def test_polars_filter_reset(dxf: DataExplorerFixture):
    # Check that we can remove all filters
    df, schema = example_polars_df()
    table_id = guid()
    dxf.register_table(table_id, df)

    # Test that passing empty filter set resets to unfiltered state
    filt = _compare_filter(schema[4], "<", 0)
    dxf.set_row_filters(table_id, filters=[filt])
    response = dxf.set_row_filters(table_id, filters=[])
    assert response == FilterResult(selected_num_rows=len(df), had_errors=False)

    # register the whole table to make sure the filters are really cleared
    ex_id = guid()
    dxf.register_table(ex_id, df)
    dxf.compare_tables(table_id, ex_id, df.shape)


def test_polars_filter_search(dxf: DataExplorerFixture):
    df = pl.DataFrame(
        {
            "a": ["foo1", "foo2", None, "2FOO", "FOO3", "bar1", "2BAR"],
        }
    )

    dxf.register_table("df", df)
    schema = dxf.get_schema("df")

    # (search_type, column_schema, term, case_sensitive, boolean mask)
    cases = [
        (
            "contains",
            schema[0],
            "foo",
            False,
            df["a"].str.to_lowercase().str.contains("foo"),
        ),
        ("contains", schema[0], "foo", True, df["a"].str.contains("foo")),
        (
            "starts_with",
            schema[0],
            "foo",
            False,
            df["a"].str.to_lowercase().str.starts_with("foo"),
        ),
        (
            "starts_with",
            schema[0],
            "foo",
            True,
            df["a"].str.starts_with("foo"),
        ),
        (
            "ends_with",
            schema[0],
            "foo",
            False,
            df["a"].str.to_lowercase().str.ends_with("foo"),
        ),
        (
            "ends_with",
            schema[0],
            "foo",
            True,
            df["a"].str.ends_with("foo"),
        ),
        (
            "regex_match",
            schema[0],
            "f[o]+",
            False,
            df["a"].str.contains("(?i)f[o]+"),
        ),
        (
            "regex_match",
            schema[0],
            "f[o]+[^o]*",
            True,
            df["a"].str.contains("f[o]+[^o]*"),
        ),
    ]

    for search_type, column_schema, term, cs, mask in cases:
        dxf.check_filter_case(
            df,
            [
                _search_filter(
                    column_schema,
                    term,
                    case_sensitive=cs,
                    search_type=search_type,
                )
            ],
            df.filter(mask),
        )


def test_polars_filter_set_membership(dxf: DataExplorerFixture):
    df = pl.DataFrame(
        {
            "a": [1, 2, 3, 4, None, 5, 6],
            "b": ["foo", "bar", None, "baz", "foo", None, "qux"],
        }
    )
    schema = dxf.get_schema_for(df)

    cases = [
        # TODO(wesm): improve this test once
        # https://github.com/pola-rs/polars/issues/17771 has a
        # resolution.
        (
            [_set_member_filter(schema[0], [2, 3.5, 4.0, 5, 6.5])],
            df.filter(df["a"].is_in(pl.Series([2, 3.5, 4.0, 5, 6.5], dtype=pl.Float64))),
        ),
        (
            [_set_member_filter(schema[0], [2, 4])],
            df.filter(df["a"].is_in([2, 4])),
        ),
        (
            [_set_member_filter(schema[1], ["bar", "foo"])],
            df.filter(df["b"].is_in(["bar", "foo"])),
        ),
        ([_set_member_filter(schema[1], [])], df.filter(df["b"].is_in([]))),
        (
            [_set_member_filter(schema[1], ["bar"], False)],
            df.filter(~df["b"].is_in(["bar"])),
        ),
        (
            [_set_member_filter(schema[1], [], False)],
            df.filter(~df["b"].is_in([])),
        ),
    ]

    for filter_set, expected_df in cases:
        dxf.check_filter_case(df, filter_set, expected_df)


@pytest.mark.skipif(
    not supports_keyword(pl.DataFrame.sort, "maintain_order"),
    reason="Older versions of polars do not support stable sorting",
)
def test_polars_set_sort_columns(dxf: DataExplorerFixture):
    tables = {
        "df1": pl.DataFrame(SIMPLE_DATA, strict=False),
        # Just some random data to test multiple keys, different sort
        # orders, etc.
        "df2": pl.DataFrame(
            {
                "a": np.random.standard_normal(10000),
                "b": np.tile(np.arange(2), 5000),
                "c": np.tile(np.arange(10), 1000),
            }
        ),
    }
    df2_schema = dxf.get_schema_for(tables["df2"])

    cases = [
        ("df1", [(2, True)], {"by": "c"}),
        ("df1", [(2, False)], {"by": "c", "descending": True}),
        # Tests stable sorting
        ("df2", [(1, True)], {"by": "b"}),
        ("df2", [(2, True)], {"by": "c"}),
        ("df2", [(0, True), (1, True)], {"by": ["a", "b"]}),
        (
            "df2",
            [(0, True), (1, False)],
            {"by": ["a", "b"], "descending": [False, True]},
        ),
        (
            "df2",
            [(2, False), (1, True), (0, False)],
            {"by": ["c", "b", "a"], "descending": [True, False, True]},
        ),
    ]

    # Test sort AND filter
    filter_cases = {
        "df2": [
            (
                lambda x: x.filter(x["a"] > 0),
                [_compare_filter(df2_schema[0], ">", 0)],
            )
        ]
    }

    for df_name, sort_keys, expected_params in cases:
        df = tables[df_name]
        wrapped_keys = [
            {"column_index": index, "ascending": ascending} for index, ascending in sort_keys
        ]

        args = (expected_params["by"],)
        kwds = {
            "descending": expected_params.get("descending", False),
            "maintain_order": True,
        }

        expected_df = df.sort(*args, **kwds)
        dxf.check_sort_case(df, wrapped_keys, expected_df)

        for filter_f, filters in filter_cases.get(df_name, []):
            expected_filtered = filter_f(df).sort(*args, **kwds)
            dxf.check_sort_case(df, wrapped_keys, expected_filtered, filters=filters)


def test_polars_profile_null_counts(dxf: DataExplorerFixture):
    df = pl.DataFrame(
        {
            "a": [0, None, 2, None, 4, 5, 6],
            "b": ["zero", None, None, None, "four", "five", "six"],
            "c": [False, False, False, None, None, None, None],
            "d": [0, 1, 2, 3, 4, 5, 6],
        }
    )

    name = guid()
    dxf.register_table(name, df)

    # tuples like (table_name, [ColumnProfileRequest], [results])
    cases = [
        (name, [], []),
        (
            name,
            [_get_null_count(3)],
            [0],
        ),
        (
            name,
            [
                _get_null_count(0),
                _get_null_count(1),
                _get_null_count(2),
                _get_null_count(3),
            ],
            [2, 3, 4, 0],
        ),
    ]

    for table_name, profiles, ex_results in cases:
        results = dxf.get_column_profiles(table_name, profiles)

        ex_results = [ColumnProfileResult(null_count=count) for count in ex_results]

        assert results == ex_results


def test_polars_profile_summary_stats(dxf: DataExplorerFixture):
    arr = np.random.standard_normal(100)
    arr_with_nulls = arr.copy().astype(object)
    arr_with_nulls[::10] = None
    arr_with_nulls = list(arr_with_nulls)

    df1 = pl.DataFrame(
        {
            "f0": arr,
            "f1": arr_with_nulls,
            "f2": [False, False, False, True, None] * 20,
            "f3": [
                "foo",
                "",
                "baz",
                "qux",
                "foo",
                None,
                "bar",
                "",
                "bar",
                "zzz",
            ]
            * 10,
            "f4": pl.Series(
                pd.date_range("2000-01-01", freq="D", periods=100),
                dtype=pl.Date,
            ),  # date column
            "f5": pl.Series(
                list(pd.date_range("2000-01-01", freq="2h", periods=100)),
                dtype=pl.Datetime("us"),
            ),  # datetime no tz
            "f6": pl.Series(
                [
                    x.replace(tzinfo=pytz.utc)
                    for x in pd.date_range("2000-01-01", freq="2h", periods=100)
                ],
                dtype=pl.Datetime("ms", time_zone="UTC"),
            ),  # datetime single tz
            "f7": [np.nan, np.inf, -np.inf, 0, np.nan] * 20,  # with infinity
            "f8": pl.Series([None] * 100, dtype=pl.Float64),
        }
    )

    dxf.register_table("df1", df1)

    format_options = FormatOptions(
        large_num_digits=4,
        small_num_digits=6,
        max_integral_digits=7,
        max_value_length=1000,
        thousands_sep="_",
    )
    _format_float = _get_float_formatter(format_options)

    cases = [
        (
            "df1",
            0,
            {
                "min_value": _format_float(arr.min()),
                "max_value": _format_float(arr.max()),
                "mean": _format_float(df1["f0"].mean()),
                "stdev": _format_float(df1["f0"].std()),
                "median": _format_float(df1["f0"].median()),
            },
        ),
        (
            "df1",
            1,
            {
                "min_value": _format_float(df1["f1"].min()),
                "max_value": _format_float(df1["f1"].max()),
                "mean": _format_float(df1["f1"].mean()),
                "stdev": _format_float(df1["f1"].std()),
                "median": _format_float(df1["f1"].median()),
            },
        ),
        (
            "df1",
            2,
            {"true_count": 20, "false_count": 60},
        ),
        (
            "df1",
            3,
            {"num_empty": 20, "num_unique": 7},
        ),
        (
            "df1",
            4,
            {
                "num_unique": 100,
                "min_date": "2000-01-01",
                "mean_date": "2000-02-19",
                "median_date": "2000-02-19",
                "max_date": "2000-04-09",
            },
        ),
        (
            "df1",
            5,
            {
                "num_unique": 100,
                "min_date": "2000-01-01 00:00:00",
                "mean_date": "2000-01-05 03:00:00",
                "median_date": "2000-01-05 03:00:00",
                "max_date": "2000-01-09 06:00:00",
                "timezone": "None",
            },
        ),
        (
            "df1",
            6,
            {
                "num_unique": 100,
                "min_date": "2000-01-01 00:00:00+00:00",
                "mean_date": "2000-01-05 03:00:00+00:00",
                "median_date": "2000-01-05 03:00:00+00:00",
                "max_date": "2000-01-09 06:00:00+00:00",
                "timezone": "UTC",
            },
        ),
        (
            "df1",
            7,
            {"min_value": "-INF", "max_value": "INF"},
        ),
        (
            "df1",
            8,
            {},
        ),
    ]

    for table_name, col_index, ex_result in cases:
        profiles = [_get_summary_stats(col_index)]
        results = dxf.get_column_profiles(table_name, profiles, format_options=format_options)

        stats = results[0]["summary_stats"]
        assert_summary_stats_equal(stats["type_display"], stats, ex_result)

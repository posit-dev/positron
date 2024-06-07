#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
#

# ruff: noqa: E712

from datetime import datetime
from decimal import Decimal
from io import StringIO
from typing import Any, Dict, List, Optional, Type, cast

import numpy as np
import pandas as pd
import polars as pl
import pytest

from .._vendor.pydantic import BaseModel
from ..access_keys import encode_access_key
from ..data_explorer import (
    _VALUE_NULL,
    _VALUE_NA,
    _VALUE_NAN,
    _VALUE_NAT,
    _VALUE_NONE,
    COMPARE_OPS,
    DataExplorerService,
    PandasView,
    _get_float_formatter,
)
from ..data_explorer_comm import (
    ColumnDisplayType,
    ColumnProfileResult,
    ColumnSchema,
    ColumnSortKey,
    FilterResult,
    FormatOptions,
    RowFilter,
)
from ..utils import guid
from .conftest import DummyComm, PositronShell
from .test_variables import BIG_ARRAY_LENGTH
from .utils import json_rpc_notification, json_rpc_request

TARGET_NAME = "positron.dataExplorer"

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


SIMPLE_PANDAS_DF = pd.DataFrame(
    {
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
    }
)


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


def _check_update_variable(de_service, name, update_type="schema"):
    paths = de_service.get_paths_for_variable(name)
    assert len(paths) > 0

    comms = [de_service.comms[comm_id] for p in paths for comm_id in de_service.path_to_comm_ids[p]]

    if update_type == "schema":
        expected_msg = json_rpc_notification("schema_update", {})
    else:
        expected_msg = json_rpc_notification("data_update", {})

    # Check that comms were all closed
    for comm in comms:
        dummy_comm = cast(DummyComm, comm.comm)
        last_message = dummy_comm.messages[-1]
        assert last_message == expected_msg
        dummy_comm.messages.clear()


def test_register_table(de_service: DataExplorerService):
    df = pd.DataFrame({"a": [1, 2, 3, 4, 5]})
    comm_id = guid()

    de_service.register_table(df, "test_table", comm_id=comm_id)

    assert comm_id in de_service.comms
    table_view = de_service.table_views[comm_id]
    assert table_view.table is df


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

    def assign_and_open_viewer(self, table_name: str, table):
        _assign_variables(self.shell, self.variables_comm, **{table_name: table})
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

    def get_schema(self, table_name, start_index=None, num_columns=None):
        if start_index is None:
            start_index = 0

        if num_columns is None:
            shape = self.get_state(table_name)["table_shape"]
            num_columns = shape["num_columns"]

        return self.do_json_rpc(
            table_name,
            "get_schema",
            start_index=start_index,
            num_columns=num_columns,
        )["columns"]

    def search_schema(self, table_name, search_term, start_index, max_results):
        return self.do_json_rpc(
            table_name,
            "search_schema",
            search_term=search_term,
            start_index=start_index,
            max_results=max_results,
        )

    def get_state(self, table_name):
        return self.do_json_rpc(table_name, "get_state")

    def get_data_values(self, table_name, format_options=DEFAULT_FORMAT, **params):
        return self.do_json_rpc(
            table_name,
            "get_data_values",
            format_options=format_options,
            **params,
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

        ex_num_rows = len(expected_table)
        assert response == FilterResult(selected_num_rows=ex_num_rows, had_errors=False)

        state = self.get_state(table_id)
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
        self.register_table(table_id, table)
        self.register_table(ex_id, expected_table)

        if filters is not None:
            self.set_row_filters(table_id, filters)

        response = self.set_sort_columns(table_id, sort_keys=sort_keys)
        assert response is None
        self.compare_tables(table_id, ex_id, table.shape)

    def compare_tables(self, table_id: str, expected_id: str, table_shape: tuple):
        # Query the data and check it yields the same result as the
        # manually constructed data frame without the filter
        response = self.get_data_values(
            table_id,
            row_start_index=0,
            num_rows=table_shape[0],
            column_indices=list(range(table_shape[1])),
        )
        ex_response = self.get_data_values(
            expected_id,
            row_start_index=0,
            num_rows=table_shape[0],
            column_indices=list(range(table_shape[1])),
        )
        assert response == ex_response


@pytest.fixture()
def dxf(
    shell: PositronShell,
    de_service: DataExplorerService,
    variables_comm: DummyComm,
):
    return DataExplorerFixture(shell, de_service, variables_comm)


def _wrap_json(model: Type[BaseModel], data: JsonRecords):
    return [model(**d).dict() for d in data]


# ----------------------------------------------------------------------
# pandas backend functionality tests


def test_pandas_get_state(dxf: DataExplorerFixture):
    result = dxf.get_state("simple")
    assert result["display_name"] == "simple"
    ex_shape = {"num_rows": 5, "num_columns": 7}
    assert result["table_shape"] == ex_shape
    assert result["table_unfiltered_shape"] == ex_shape

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

    ex_filtered_shape = {"num_rows": 2, "num_columns": 7}
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

    assert search_schema["supported"]

    assert row_filters["supported"]
    assert row_filters["supports_conditions"]
    assert set(row_filters["supported_types"]) == {
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
    }

    assert column_profiles["supported"]
    assert set(column_profiles["supported_types"]) == {
        "null_count",
        "summary_stats",
    }


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
    result = dxf.get_schema("full_schema", 0, 100)
    assert result == _wrap_json(ColumnSchema, full_schema)

    # Test partial schema gets, boundschecking
    result = dxf.get_schema("full_schema", 2, 100)
    assert result == _wrap_json(ColumnSchema, full_schema[2:])

    result = dxf.get_schema("simple", len(cases), 100)
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

    result = dxf.get_schema(bigger_name, 0, 100)
    assert result == _wrap_json(ColumnSchema, bigger_schema[:100])

    result = dxf.get_schema(bigger_name, 10, 10)
    assert result == _wrap_json(ColumnSchema, bigger_schema[10:20])


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

        schema_slice = dxf.get_schema("wide_df", start_index, chunk_size)
        expected = dxf.get_schema(f"wide_df_{chunk_index}", 0, chunk_size)

        for left, right in zip(schema_slice, expected):
            right["column_index"] = right["column_index"] + start_index
            assert left == right


def test_pandas_search_schema(dxf: DataExplorerFixture):
    # Make a few thousand column names we can search for
    column_names = [
        f"{prefix}_{i}"
        for prefix in ["aaa", "bbb", "ccc", "ddd"]
        for i in range({"aaa": 1000, "bbb": 100, "ccc": 50, "ddd": 10}[prefix])
    ]

    # Make a data frame with those column names
    arr = np.arange(10)
    df = pd.DataFrame({name: arr for name in column_names}, columns=pd.Index(column_names))

    dxf.register_table("df", df)

    full_schema = dxf.get_schema("df", 0, len(column_names))

    # (search_term, start_index, max_results, ex_total, ex_matches)
    cases = [
        ("aaa", 0, 100, 1000, full_schema[:100]),
        ("aaa", 100, 100, 1000, full_schema[100:200]),
        ("aaa", 950, 100, 1000, full_schema[950:1000]),
        ("aaa", 1000, 100, 1000, []),
        ("bbb", 0, 10, 100, full_schema[1000:1010]),
        ("ccc", 0, 10, 50, full_schema[1100:1110]),
        ("ddd", 0, 10, 10, full_schema[1150:1160]),
    ]

    for search_term, start_index, max_results, ex_total, ex_matches in cases:
        result = dxf.search_schema("df", search_term, start_index, max_results)

        assert result["total_num_matches"] == ex_total
        matches = result["matches"]["columns"]
        assert matches == ex_matches


def test_pandas_get_data_values(dxf: DataExplorerFixture):
    result = dxf.get_data_values(
        "simple",
        row_start_index=0,
        num_rows=20,
        column_indices=list(range(6)),
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
    ]

    assert result["columns"] == expected_columns

    assert result["row_labels"] == [["0", "1", "2", "3", "4"]]

    # Edge cases: request beyond end of table
    response = dxf.get_data_values("simple", row_start_index=5, num_rows=10, column_indices=[0])
    assert response["columns"] == [[]]

    # Issue #2149 -- return empty result when requesting non-existent
    # column indices
    response = dxf.get_data_values(
        "simple", row_start_index=0, num_rows=5, column_indices=[2, 3, 4, 5]
    )
    assert response["columns"] == expected_columns[2:]

    # Edge case: request invalid column index
    # Per issue #2149, until we can align on whether the UI is allowed
    # to request non-existent column indices, disable this test

    # with pytest.raises(IndexError):
    #     dxf.get_data_values(
    #         "simple", row_start_index=0, num_rows=10, column_indices=[4]
    #     )


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
            FormatOptions(large_num_digits=2, small_num_digits=4, max_integral_digits=7),
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
            ],
        ),
        (
            FormatOptions(
                large_num_digits=3,
                small_num_digits=4,
                max_integral_digits=7,
                thousands_sep="_",
            ),
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
            ],
        ),
    ]

    for options, expected in cases:
        result = dxf.get_data_values(
            "df",
            row_start_index=0,
            num_rows=20,
            column_indices=[0],
            format_options=options,
        )

        assert result["columns"][0] == expected


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

    result = dxf.get_data_values(
        "df",
        row_start_index=0,
        num_rows=5,
        column_indices=list(range(3)),
    )

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
    result = dxf.get_data_values(
        "ws",
        row_start_index=0,
        num_rows=5,
        column_indices=list(range(6)),
    )

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
        compare_params={"op": op, "value": str(value)},
    )


def _between_filter(column_schema, left_value, right_value, op="between", condition="and"):
    return _filter(
        op,
        column_schema,
        condition=condition,
        between_params={
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
        search_params={
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
        set_membership_params={
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
    import pytz

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


def test_pandas_filter_value_coercion(dxf: DataExplorerFixture):
    table_name = "coerce"
    df = pd.DataFrame(
        {
            "a": [1, 2, 3, 4, 5],
            "b": pd.date_range("2000-01-01", freq="D", periods=5),
        }
    )
    dxf.register_table(table_name, df)
    schema = dxf.get_schema(table_name)

    error_cases = [
        _compare_filter(schema[1], "<", "123456789"),
        _compare_filter(schema[1], "<", "2024"),
        _compare_filter(schema[1], "<", "2024-01"),
        _compare_filter(schema[1], "<", "2024-13-01"),
        _compare_filter(schema[1], "<", "2024-01-32"),
    ]

    for filt in error_cases:
        result = dxf.set_row_filters(table_name, filters=[filt])
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


def test_pandas_variable_updates(
    shell: PositronShell,
    de_service: DataExplorerService,
    variables_comm: DummyComm,
    dxf: DataExplorerFixture,
):
    x = pd.DataFrame({"a": [1, 0, 3, 4]})
    big_array = np.arange(BIG_ARRAY_LENGTH)
    big_x = pd.DataFrame({"a": big_array})

    _assign_variables(
        shell,
        variables_comm,
        x=x,
        big_x=big_x,
        y={"key1": SIMPLE_PANDAS_DF, "key2": SIMPLE_PANDAS_DF},
    )

    # Check updates

    path_x = _open_viewer(variables_comm, ["x"])
    _open_viewer(variables_comm, ["big_x"])
    _open_viewer(variables_comm, ["y", "key1"])
    _open_viewer(variables_comm, ["y", "key2"])
    _open_viewer(variables_comm, ["y", "key2"])

    # Do a simple update and make sure that sort keys are preserved
    x_comm_id = list(de_service.path_to_comm_ids[path_x])[0]
    x_sort_keys = [{"column_index": 0, "ascending": True}]
    msg = json_rpc_request(
        "set_sort_columns",
        params={"sort_keys": x_sort_keys},  # type: ignore
        comm_id=x_comm_id,
    )
    de_service.comms[x_comm_id].comm.handle_msg(msg)
    shell.run_cell("import pandas as pd")
    shell.run_cell("x = pd.DataFrame({'a': [1, 0, 3, 4, 5]})")
    _check_update_variable(de_service, "x", update_type="data")

    tv = de_service.table_views[x_comm_id]
    assert tv.sort_keys == [ColumnSortKey(**k) for k in x_sort_keys]
    assert tv._need_recompute

    new_state = dxf.get_state("x")
    assert new_state["display_name"] == "x"
    assert new_state["table_shape"]["num_rows"] == 5
    assert new_state["table_shape"]["num_columns"] == 1
    assert new_state["sort_keys"] == [ColumnSortKey(**k) for k in x_sort_keys]

    # Execute code that triggers an update event for big_x because it's large
    shell.run_cell("None")
    _check_update_variable(de_service, "big_x", update_type="schema")

    # Update nested values in y and check for schema updates
    shell.run_cell(
        """y = {'key1': y['key1'].iloc[:1]],
    'key2': y['key2'].copy()}
    """
    )
    _check_update_variable(de_service, "y", update_type="schema")

    shell.run_cell(
        """y = {'key1': y['key1'].iloc[:-1, :-1],
    'key2': y['key2'].copy().iloc[:, 1:]}
    """
    )
    _check_update_variable(de_service, "y", update_type="schema")


def test_pandas_schema_change_state_updates(dxf: DataExplorerFixture):
    df = pd.DataFrame(
        {
            "a": [1, 2, 3, 4, 5],
            "b": ["foo", "bar", None, "baz", "qux"],
            "c": [False, True, False, True, False],
        }
    )

    dxf.assign_and_open_viewer("df", df.copy())
    schema = dxf.get_schema("df")

    def _check_scenario(var, scenario, code: str):
        filter_spec = scenario.get("filters", [])

        if "sort_keys" in scenario:
            dxf.set_sort_columns(var, sort_keys=scenario["sort_keys"])

        if len(filter_spec) > 0:
            dxf.set_row_filters(var, filters=list(zip(*filter_spec))[0])

        dxf.execute_code(code)

        # Get state and confirm that the right filters were made
        # invalid
        state = dxf.get_state(var)
        updated_filters = state["row_filters"]
        new_schema = dxf.get_schema(var)

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

    # Scenario 1: convert "a" from integer to string
    # (filter, is_valid_after_change)
    dxf.assign_and_open_viewer("df1", df.copy())
    scenario1 = {
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

    _check_scenario("df1", scenario1, "df1['a'] = df1['a'].astype(str)")

    # Scenario 2: convert "a" from int64 to int16
    dxf.assign_and_open_viewer("df2", df.copy())
    schema = dxf.get_schema("df2")
    scenario2 = {
        "filters": [
            (_filter("is_null", schema[0]), True),
            (_compare_filter(schema[0], "<", "4"), True),
            (_between_filter(schema[0], "1", "3"), True),
        ]
    }
    _check_scenario("df2", scenario2, "df2['a'] = df2['a'].astype('int16')")

    # Scenario 3: delete "a" in place
    dxf.assign_and_open_viewer("df3", df.copy())
    schema = dxf.get_schema("df3")
    scenario3 = {
        "filters": [
            (_filter("is_null", schema[0]), False),
            (_compare_filter(schema[0], "<", "4"), False),
        ],
        "sort_keys": [{"column_index": 0, "ascending": True}],
        "updated_sort_keys": [],
    }
    _check_scenario("df3", scenario3, "del df3['a']")

    # Scenario 4: delete "a" in a new DataFrame
    dxf.assign_and_open_viewer("df4", df.copy())
    schema = dxf.get_schema("df4")
    scenario4 = {
        "filters": [
            (_filter("is_null", schema[0]), False),
            (_compare_filter(schema[0], "<", "4"), False),
        ]
    }
    _check_scenario("df4", scenario4, "df4 = df4[['b']]")

    # Scenario 5: replace a column in place with a new name
    dxf.assign_and_open_viewer("df5", df.copy())
    schema = dxf.get_schema("df5")
    scenario5 = {
        "filters": [
            (_compare_filter(schema[1], "=", "foo"), False),
        ]
    }
    _check_scenario("df5", scenario5, "df5.insert(1, 'c', df5.pop('b'))")

    # Scenario 6: add some columns, but do not disturb filters
    dxf.assign_and_open_viewer("df6", df.copy())
    schema = dxf.get_schema("df6")
    scenario6 = {
        "filters": [
            (_compare_filter(schema[0], "=", "1"), True),
            (_compare_filter(schema[1], "=", "foo"), True),
        ]
    }
    _check_scenario("df6", scenario6, "df6['c'] = df6['b']")

    # Scenario 7: delete column, then restore it and check that the
    # filter was made invalid and then valid again
    dxf.assign_and_open_viewer("df7", df.copy())
    schema = dxf.get_schema("df7")
    scenario7 = {
        "filters": [
            (_compare_filter(schema[0], "<", "4"), False),
        ]
    }
    # Scenario 7 -- Validate the setup, so the filter will be invalid
    # after this
    _check_scenario("df7", scenario7, "del df7['a']")

    # Scenario 7 -- Now restore df7 to its prior state
    dxf.execute_code("df7 = df.copy()")
    state = dxf.get_state("df7")

    # Filter is made valid again because the column reappeared where
    # it was before and with a compatible type
    filt = state["row_filters"][0]
    assert filt["is_valid"]
    assert filt["error_message"] is None

    # Scenario 8: Delete sorted column in middle of table
    dxf.assign_and_open_viewer("df8", df.copy())
    scenario8 = {
        "sort_keys": [{"column_index": 1, "ascending": False}],
        "updated_sort_keys": [],
    }
    _check_scenario("df8", scenario8, "del df8['b']")


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
    df = pd.DataFrame(
        {
            "a": [1, 2, 3, 4, 5],
            "b": [True, False, True, None, True],
            "c": ["foo", "bar", None, "bar", "None"],
        }
    )

    comm_id = dxf.assign_and_open_viewer("df", df)
    view = dxf.de_service.table_views[comm_id]
    dxf.set_sort_columns("df", [{"column_index": 0, "ascending": False}])

    view = PandasView("df", df, view.filters, view.sort_keys)

    schema_updated, new_filt, new_sort_keys = view.get_updated_state(df)

    # Object dtype makes schema_updated always true
    assert schema_updated
    assert new_filt == view.filters
    assert new_sort_keys == view.sort_keys


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


def test_pandas_export_data_selection(dxf: DataExplorerFixture):
    length = 100
    ncols = 20

    np.random.seed(12345)
    df = pd.DataFrame({f"a{i}": np.random.standard_normal(length) for i in range(ncols)})

    dxf.register_table("df", df)
    dxf.register_table("filtered", df)

    schema = dxf.get_schema("filtered")
    dxf.set_row_filters("filtered", filters=[_compare_filter(schema[0], ">", "0")])

    filtered = df[df.iloc[:, 0] > 0]

    # Test exporting single cells
    single_cell_cases = [(0, 0), (5, 10), (25, 15), (99, 19)]

    for row_index, col_index in single_cell_cases:
        selection = _select_single_cell(row_index, col_index)
        df_result = dxf.export_data_selection("df", selection, "tsv")
        df_expected = str(df.iat[row_index, col_index])
        assert df_result["data"] == df_expected
        assert df_result["format"] == "tsv"

        filt_row_index = min(row_index, len(filtered) - 1)
        filt_selection = _select_single_cell(filt_row_index, col_index)
        filt_result = dxf.export_data_selection("filtered", filt_selection, "csv")
        filt_expected = str(filtered.iat[filt_row_index, col_index])
        assert filt_result["data"] == filt_expected

    # Test exporting ranges
    range_cases = [
        (_select_cell_range(1, 4, 10, 19), (slice(1, 5), slice(10, 20))),
        (_select_cell_range(1, 1, 4, 4), (slice(1, 2), slice(4, 5))),
        (_select_column_range(1, 5), (slice(None), slice(1, 6))),
        (_select_row_range(1, 5), (slice(1, 6), slice(None))),
        (_select_row_indices([0, 3, 5, 7]), ([0, 3, 5, 7], slice(None))),
        (_select_column_indices([0, 3, 5, 7]), (slice(None), [0, 3, 5, 7])),
    ]

    def do_export(x, fmt):
        buf = StringIO()
        if fmt == "csv":
            x.to_csv(buf, index=False)
        elif fmt == "tsv":
            x.to_csv(buf, sep="\t", index=False)
        elif fmt == "html":
            x.to_html(buf, index=False)
        return buf.getvalue()

    for rpc_selection, selector in range_cases:
        df_selected = df.iloc[selector]
        filtered_selected = filtered.iloc[selector]

        for fmt in ["csv", "tsv", "html"]:
            df_result = dxf.export_data_selection("df", rpc_selection, fmt)
            df_expected = do_export(df_selected, fmt)

            assert df_result["data"] == df_expected
            assert df_result["format"] == fmt

            filt_result = dxf.export_data_selection("filtered", rpc_selection, fmt)
            filt_expected = do_export(filtered_selected, fmt)
            assert filt_result["data"] == filt_expected


def _profile_request(column_index, profile_type):
    return {"column_index": column_index, "profile_type": profile_type}


def _get_null_count(column_index):
    return _profile_request(column_index, "null_count")


def _get_summary_stats(column_index):
    return _profile_request(column_index, "summary_stats")


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
    assert np.abs(actual - expected) < EPSILON


def _assert_numeric_stats_equal(expected, actual):
    for attr, value in expected.items():
        _assert_close(float(value), float(actual.get(attr)))


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
            "a": arr,
            "b": arr_with_nulls,
            "c": [False, False, False, True, None] * 20,
            "d": [
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
            "e": getattr(pd.date_range("2000-01-01", freq="D", periods=100), "date"),  # date column
            "f": pd.date_range("2000-01-01", freq="2h", periods=100),  # datetime no tz
            "g": pd.date_range(
                "2000-01-01", freq="2h", periods=100, tz="US/Eastern"
            ),  # datetime single tz
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
                "mean": _format_float(df1["a"].mean()),
                "stdev": _format_float(df1["a"].std()),
                "median": _format_float(df1["a"].median()),
            },
        ),
        (
            "df1",
            1,
            {
                "min_value": _format_float(df1["b"].min()),
                "max_value": _format_float(df1["b"].max()),
                "mean": _format_float(df1["b"].mean()),
                "stdev": _format_float(df1["b"].std()),
                "median": _format_float(df1["b"].median()),
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
        ui_type = stats["type_display"]

        if ui_type == ColumnDisplayType.Number:
            _assert_numeric_stats_equal(ex_result, stats["number_stats"])
        elif ui_type == ColumnDisplayType.String:
            _assert_string_stats_equal(ex_result, stats["string_stats"])
        elif ui_type == ColumnDisplayType.Boolean:
            _assert_boolean_stats_equal(ex_result, stats["boolean_stats"])
        elif ui_type == ColumnDisplayType.Date:
            _assert_date_stats_equal(ex_result, stats["date_stats"])
        elif ui_type == ColumnDisplayType.Datetime:
            _assert_datetime_stats_equal(ex_result, stats["datetime_stats"])


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
            Decimal("0"),
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
        full_data.append(pl.Series(name=name, values=data, dtype=dtype))
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
    result = dxf.get_schema(table_name, 0, len(df.columns))

    assert result == _wrap_json(ColumnSchema, full_schema)

    # Test partial gets, boundschecking
    assert dxf.get_schema(table_name, 0, 0) == []
    assert dxf.get_schema(table_name, 5, 5) == _wrap_json(ColumnSchema, full_schema[5:10])
    assert dxf.get_schema(table_name, 5, 100) == _wrap_json(ColumnSchema, full_schema[5:])


def test_polars_get_state(dxf: DataExplorerFixture):
    df, _ = example_polars_df()
    dxf.register_table("df", df)

    state = dxf.get_state("df")
    ex_shape = {"num_rows": df.shape[0], "num_columns": df.shape[1]}

    assert state["display_name"] == "df"
    assert state["table_shape"] == ex_shape
    assert state["table_unfiltered_shape"] == ex_shape
    assert state["sort_keys"] == []
    assert state["row_filters"] == []

    features = state["supported_features"]
    assert not features["search_schema"]["supported"]
    assert not features["set_row_filters"]["supported"]
    assert features["get_column_profiles"]["supported"]
    assert features["get_column_profiles"]["supported_types"] == ["null_count"]


def test_polars_get_data_values(dxf: DataExplorerFixture):
    df, _ = example_polars_df()
    dxf.register_table("df", df)

    result = dxf.get_data_values(
        "df",
        row_start_index=0,
        num_rows=10,
        column_indices=list(range(df.shape[1])),
    )

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
    assert result["row_labels"] is None

    result = dxf.get_data_values(
        "df",
        row_start_index=2,
        num_rows=10,
        column_indices=list(range(15, df.shape[1])),
    )
    assert result["columns"] == [x[2:] for x in expected_columns[15:]]

    result = dxf.get_data_values("df", row_start_index=10, num_rows=10, column_indices=[])
    assert result["columns"] == []
    assert result["row_labels"] is None

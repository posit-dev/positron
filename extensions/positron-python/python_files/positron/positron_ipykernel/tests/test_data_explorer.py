#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
#

import uuid
from typing import Any, Dict, List, Optional, Type, cast

import numpy as np
import pandas as pd
import pytest

from .._vendor.pydantic import BaseModel
from ..access_keys import encode_access_key
from ..data_explorer import COMPARE_OPS, DataExplorerService
from ..data_explorer_comm import (
    ColumnDisplayType,
    RowFilter,
    ColumnProfileResult,
    ColumnSchema,
    ColumnSortKey,
    FilterResult,
)
from .conftest import DummyComm, PositronShell
from .test_variables import BIG_ARRAY_LENGTH
from .utils import json_rpc_notification, json_rpc_request, json_rpc_response

TARGET_NAME = "positron.dataExplorer"

# ----------------------------------------------------------------------
# pytest fixtures


def guid():
    return str(uuid.uuid4())


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
        "c": ["foo", "bar", None, "bar", "qux"],
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
    assert variables_comm.messages == [json_rpc_response({})]
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


def _check_update_variable(de_service, name, update_type="schema", discard_state=True):
    paths = de_service.get_paths_for_variable(name)
    assert len(paths) > 0

    comms = [de_service.comms[comm_id] for p in paths for comm_id in de_service.path_to_comm_ids[p]]

    if update_type == "schema":
        expected_msg = json_rpc_notification("schema_update", {"discard_state": discard_state})
    else:
        expected_msg = json_rpc_notification("data_update", {})

    # Check that comms were all closed
    for comm in comms:
        last_message = cast(DummyComm, comm.comm).messages[-1]
        assert last_message == expected_msg


def test_explorer_variable_updates(
    shell: PositronShell,
    de_service: DataExplorerService,
    variables_comm: DummyComm,
):
    x = pd.DataFrame({"a": [1, 0, 3, 4]})
    big_x = pd.DataFrame({"a": np.arange(BIG_ARRAY_LENGTH)})

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
        params={"sort_keys": [{"column_index": 0, "ascending": True}]},
        comm_id=x_comm_id,
    )
    de_service.comms[x_comm_id].comm.handle_msg(msg)
    shell.run_cell("import pandas as pd")
    shell.run_cell("x = pd.DataFrame({'a': [1, 0, 3, 4, 5]})")
    _check_update_variable(de_service, "x", update_type="data")

    tv = de_service.table_views[x_comm_id]
    assert tv.sort_keys == [ColumnSortKey(**k) for k in x_sort_keys]
    assert tv._need_recompute

    dxf = DataExplorerFixture(de_service)
    new_state = dxf.get_state("x")
    assert new_state["table_shape"]["num_rows"] == 5
    assert new_state["table_shape"]["num_columns"] == 1
    assert new_state["sort_keys"] == [ColumnSortKey(**k) for k in x_sort_keys]

    # Execute code that triggers an update event for big_x because it's large
    shell.run_cell("print('hello world')")
    _check_update_variable(de_service, "big_x", update_type="data")

    # Update nested values in y and check for schema updates
    shell.run_cell(
        """y = {'key1': y['key1'].iloc[:1]],
    'key2': y['key2'].copy()}
    """
    )
    _check_update_variable(de_service, "y", update_type="update", discard_state=False)

    shell.run_cell(
        """y = {'key1': y['key1'].iloc[:-1, :-1],
    'key2': y['key2'].copy().iloc[:, 1:]}
    """
    )
    _check_update_variable(de_service, "y", update_type="schema", discard_state=True)


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


class DataExplorerFixture:
    def __init__(self, de_service: DataExplorerService):
        self.de_service = de_service

        self.register_table("simple", SIMPLE_PANDAS_DF)

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
        if "error" in data:
            raise Exception(data["error"]["message"])
        else:
            return data["result"]

    def get_schema(self, table_name, start_index, num_columns):
        return self.do_json_rpc(
            table_name,
            "get_schema",
            start_index=start_index,
            num_columns=num_columns,
        )

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

    def get_data_values(self, table_name, **params):
        return self.do_json_rpc(table_name, "get_data_values", **params)

    def set_row_filters(self, table_name, filters=None):
        return self.do_json_rpc(table_name, "set_row_filters", filters=filters)

    def set_sort_columns(self, table_name, sort_keys=None):
        return self.do_json_rpc(table_name, "set_sort_columns", sort_keys=sort_keys)

    def get_column_profiles(self, table_name, profiles):
        return self.do_json_rpc(table_name, "get_column_profiles", profiles=profiles)

    def check_filter_case(self, table, filter_set, expected_table):
        table_id = guid()
        ex_id = guid()
        self.register_table(table_id, table)
        self.register_table(ex_id, expected_table)

        response = self.set_row_filters(table_id, filters=filter_set)

        ex_num_rows = len(expected_table)
        assert response == FilterResult(selected_num_rows=ex_num_rows)

        assert self.get_state(table_id)["table_shape"]["num_rows"] == ex_num_rows
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
def dxf(de_service: DataExplorerService):
    return DataExplorerFixture(de_service)


def _wrap_json(model: Type[BaseModel], data: JsonRecords):
    return [model(**d).dict() for d in data]


def test_pandas_get_state(dxf: DataExplorerFixture):
    result = dxf.get_state("simple")
    assert result["table_shape"]["num_rows"] == 5
    assert result["table_shape"]["num_columns"] == 6

    sort_keys = [
        {"column_index": 0, "ascending": True},
        {"column_index": 1, "ascending": False},
    ]
    filters = [_compare_filter(0, ">", 0), _compare_filter(0, "<", 5)]
    dxf.set_sort_columns("simple", sort_keys=sort_keys)
    dxf.set_row_filters("simple", filters=filters)

    result = dxf.get_state("simple")
    assert result["sort_keys"] == sort_keys
    assert result["row_filters"] == [RowFilter(**f) for f in filters]


def test_pandas_supported_features(dxf: DataExplorerFixture):
    dxf.register_table("example", SIMPLE_PANDAS_DF)
    features = dxf.get_state("example")["supported_features"]

    search_schema = features["search_schema"]
    row_filters = features["set_row_filters"]
    column_profiles = features["get_column_profiles"]

    assert search_schema["supported"]

    assert row_filters["supported"]
    assert not row_filters["supports_conditions"]
    assert set(row_filters["supported_types"]) == {
        "is_null",
        "not_null",
        "between",
        "compare",
        "not_between",
        "search",
        "set_membership",
    }

    assert column_profiles["supported"]
    assert set(column_profiles["supported_types"]) == {
        "null_count",
        "summary_stats",
    }


def test_pandas_get_schema(dxf: DataExplorerFixture):
    result = dxf.get_schema("simple", 0, 100)

    full_schema = [
        {
            "column_name": "a",
            "column_index": 0,
            "type_name": "int64",
            "type_display": "number",
        },
        {
            "column_name": "b",
            "column_index": 1,
            "type_name": "boolean",
            "type_display": "boolean",
        },
        {
            "column_name": "c",
            "column_index": 2,
            "type_name": "string",
            "type_display": "string",
        },
        {
            "column_name": "d",
            "column_index": 3,
            "type_name": "float64",
            "type_display": "number",
        },
        {
            "column_name": "e",
            "column_index": 4,
            "type_name": "datetime64[ns]",
            "type_display": "datetime",
        },
        {
            "column_name": "f",
            "column_index": 5,
            "type_name": "mixed",
            "type_display": "unknown",
        },
    ]

    assert result["columns"] == _wrap_json(ColumnSchema, full_schema)

    result = dxf.get_schema("simple", 2, 100)
    assert result["columns"] == _wrap_json(ColumnSchema, full_schema[2:])

    result = dxf.get_schema("simple", 6, 100)
    assert result["columns"] == []

    # Make a really big schema
    bigger_df = pd.concat([SIMPLE_PANDAS_DF] * 100, axis="columns")
    bigger_name = guid()
    bigger_schema = full_schema * 100

    # Fix the column indexes
    for i, c in enumerate(bigger_schema):
        c = c.copy()
        c["column_index"] = i
        bigger_schema[i] = c

    dxf.register_table(bigger_name, bigger_df)

    result = dxf.get_schema(bigger_name, 0, 100)
    assert result["columns"] == _wrap_json(ColumnSchema, bigger_schema[:100])

    result = dxf.get_schema(bigger_name, 10, 10)
    assert result["columns"] == _wrap_json(ColumnSchema, bigger_schema[10:20])


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

        for left, right in zip(schema_slice["columns"], expected["columns"]):
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

    full_schema = dxf.get_schema("df", 0, len(column_names))["columns"]

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


def _trim_whitespace(columns):
    return [[x.strip() for x in column] for column in columns]


def test_pandas_get_data_values(dxf: DataExplorerFixture):
    result = dxf.get_data_values(
        "simple",
        row_start_index=0,
        num_rows=20,
        column_indices=list(range(6)),
    )

    # TODO: pandas pads all values to fixed width, do we want to do
    # something different?
    expected_columns = [
        ["1", "2", "3", "4", "5"],
        ["True", "False", "True", "None", "True"],
        ["foo", "bar", "None", "bar", "qux"],
        ["0.0", "1.2", "-4.5", "6.0", "NaN"],
        [
            "2024-01-01 00:00:00",
            "2024-01-02 12:34:45",
            "NaT",
            "2024-01-04 00:00:00",
            "2024-01-05 00:00:00",
        ],
        ["None", "5", "-1", "None", "None"],
    ]

    assert _trim_whitespace(result["columns"]) == expected_columns

    assert result["row_labels"] == [["0", "1", "2", "3", "4"]]

    # Edge cases: request beyond end of table
    response = dxf.get_data_values("simple", row_start_index=5, num_rows=10, column_indices=[0])
    assert response["columns"] == [[]]

    # Issue #2149 -- return empty result when requesting non-existent
    # column indices
    response = dxf.get_data_values(
        "simple", row_start_index=0, num_rows=5, column_indices=[2, 3, 4, 5]
    )
    assert _trim_whitespace(response["columns"]) == expected_columns[2:]

    # Edge case: request invalid column index
    # Per issue #2149, until we can align on whether the UI is allowed
    # to request non-existent column indices, disable this test

    # with pytest.raises(IndexError):
    #     dxf.get_data_values(
    #         "simple", row_start_index=0, num_rows=10, column_indices=[4]
    #     )


def _filter(filter_type, column_index, condition="and", is_valid=None, **kwargs):
    kwargs.update(
        {
            "filter_type": filter_type,
            "column_index": column_index,
            "condition": condition,
            "is_valid": is_valid,
        }
    )
    return kwargs


def _compare_filter(column_index, op, value, condition="and", is_valid=None):
    return _filter(
        "compare",
        column_index,
        condition=condition,
        is_valid=is_valid,
        compare_params={"op": op, "value": value},
    )


def _between_filter(column_index, left_value, right_value, op="between", condition="and"):
    return _filter(
        op,
        column_index,
        condition=condition,
        between_params={"left_value": left_value, "right_value": right_value},
    )


def _not_between_filter(column_index, left_value, right_value, condition="and"):
    return _between_filter(
        column_index,
        left_value,
        right_value,
        op="not_between",
        condition=condition,
    )


def _search_filter(
    column_index,
    term,
    case_sensitive=False,
    search_type="contains",
    condition="and",
):
    return _filter(
        "search",
        column_index,
        condition=condition,
        search_params={
            "search_type": search_type,
            "term": term,
            "case_sensitive": case_sensitive,
        },
    )


def _set_member_filter(
    column_index,
    values,
    inclusive=True,
    condition="and",
):
    return _filter(
        "set_membership",
        column_index,
        condition=condition,
        set_membership_params={"values": values, "inclusive": inclusive},
    )


def test_pandas_filter_between(dxf: DataExplorerFixture):
    df = SIMPLE_PANDAS_DF
    column = "a"
    column_index = df.columns.get_loc(column)

    cases = [
        (0, 2, 4),  # a column
        (3, 0, 2),  # d column
    ]

    for column_index, left_value, right_value in cases:
        col = df.iloc[:, column_index]

        ex_between = df[(col >= left_value) & (col <= right_value)]
        ex_not_between = df[(col < left_value) | (col > right_value)]

        dxf.check_filter_case(
            df,
            [_between_filter(column_index, str(left_value), str(right_value))],
            ex_between,
        )
        dxf.check_filter_case(
            df,
            [_not_between_filter(column_index, str(left_value), str(right_value))],
            ex_not_between,
        )


def test_pandas_filter_conditions(dxf: DataExplorerFixture):
    # Test AND/OR conditions when filtering
    df = SIMPLE_PANDAS_DF
    filters = [
        _compare_filter(0, ">=", 3, condition="or"),
        _compare_filter(3, "<=", -4.5, condition="or"),
        _compare_filter(3, "<=", -4.5, condition="or"),
    ]

    expected_df = df[(df["a"] >= 3) | (df["d"] <= -4.5)]
    dxf.check_filter_case(df, filters, expected_df)

    # Test a single condition with or set
    filters = [
        _compare_filter(0, ">=", 3, condition="or"),
    ]
    dxf.check_filter_case(df, filters, df[df["a"] >= 3])


def test_pandas_filter_compare(dxf: DataExplorerFixture):
    # Just use the 'a' column to smoke test comparison filters on
    # integers
    table_name = "simple"
    df = SIMPLE_PANDAS_DF
    compare_value = 3
    column = "a"
    column_index = df.columns.get_loc(column)

    for op, op_func in COMPARE_OPS.items():
        filt = _compare_filter(column_index, op, str(compare_value))
        expected_df = df[op_func(df[column], compare_value)]
        dxf.check_filter_case(df, [filt], expected_df)

    # TODO(wesm): move these tests to their own test case

    # Test that passing empty filter set resets to unfiltered state
    filt = _compare_filter(column_index, "<", str(compare_value))
    _ = dxf.set_row_filters(table_name, filters=[filt])
    response = dxf.set_row_filters(table_name, filters=[])
    assert response == FilterResult(selected_num_rows=len(df))

    # register the whole table to make sure the filters are really cleared
    ex_id = guid()
    dxf.register_table(ex_id, df)
    dxf.compare_tables(table_name, ex_id, df.shape)


def test_pandas_filter_is_valid(dxf: DataExplorerFixture):
    # Test AND/OR conditions when filtering
    df = SIMPLE_PANDAS_DF
    filters = [
        _compare_filter(0, ">=", 3),
        _compare_filter(0, "<", 3, is_valid=False),
    ]

    expected_df = df[df["a"] >= 3]
    dxf.check_filter_case(df, filters, expected_df)

    # No filter is valid
    filters = [
        _compare_filter(0, ">=", 3, is_valid=False),
        _compare_filter(0, "<", 3, is_valid=False),
    ]

    dxf.check_filter_case(df, filters, df)


def test_pandas_filter_empty(dxf: DataExplorerFixture):
    df = pd.DataFrame(
        {
            "a": ["foo", "bar", "", "", "", None, "baz", ""],
            "b": [b"foo", b"bar", b"", b"", None, b"", b"baz", b""],
        }
    )

    dxf.check_filter_case(df, [_filter("is_empty", 0)], df[df["a"].str.len() == 0])
    dxf.check_filter_case(df, [_filter("not_empty", 0)], df[df["a"].str.len() != 0])
    dxf.check_filter_case(df, [_filter("is_empty", 1)], df[df["b"].str.len() == 0])
    dxf.check_filter_case(df, [_filter("not_empty", 1)], df[df["b"].str.len() != 0])


def test_pandas_filter_is_null_not_null(dxf: DataExplorerFixture):
    df = SIMPLE_PANDAS_DF
    b_is_null = _filter("is_null", 1)
    b_not_null = _filter("not_null", 1)
    c_not_null = _filter("not_null", 2)

    cases = [
        [[b_is_null], df[df["b"].isnull()]],
        [[b_not_null], df[df["b"].notnull()]],
        [[b_not_null, c_not_null], df[df["b"].notnull() & df["c"].notnull()]],
    ]

    for filter_set, expected_df in cases:
        dxf.check_filter_case(df, filter_set, expected_df)


def test_pandas_filter_set_membership(dxf: DataExplorerFixture):
    df = SIMPLE_PANDAS_DF

    cases = [
        [[_set_member_filter(0, [2, 4])], df[df["a"].isin([2, 4])]],
        [
            [_set_member_filter(2, ["bar", "foo"])],
            df[df["c"].isin(["bar", "foo"])],
        ],
        [[_set_member_filter(2, [])], df[df["c"].isin([])]],
        [[_set_member_filter(2, ["bar"], False)], df[~df["c"].isin(["bar"])]],
        [[_set_member_filter(2, [], False)], df],
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

    # (search_type, column_index, term, case_sensitive, boolean mask)
    cases = [
        ("contains", 0, "foo", False, df["a"].str.lower().str.contains("foo")),
        ("contains", 0, "foo", True, df["a"].str.contains("foo")),
        (
            "starts_with",
            0,
            "foo",
            False,
            df["a"].str.lower().str.startswith("foo"),
        ),
        (
            "starts_with",
            0,
            "foo",
            True,
            df["a"].str.startswith("foo"),
        ),
        (
            "ends_with",
            0,
            "foo",
            False,
            df["a"].str.lower().str.endswith("foo"),
        ),
        (
            "ends_with",
            0,
            "foo",
            True,
            df["a"].str.endswith("foo"),
        ),
        (
            "regex_match",
            0,
            "f[o]+",
            False,
            df["a"].str.match("f[o]+", case=False),
        ),
        (
            "regex_match",
            0,
            "f[o]+[^o]*",
            True,
            df["a"].str.match("f[o]+[^o]*", case=True),
        ),
    ]

    for search_type, column_index, term, cs, mask in cases:
        mask[mask.isna()] = False
        ex_table = df[mask.astype(bool)]
        dxf.check_filter_case(
            df,
            [
                _search_filter(
                    column_index,
                    term,
                    case_sensitive=cs,
                    search_type=search_type,
                )
            ],
            ex_table,
        )


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
    filter_cases = {"df2": [(lambda x: x[x["a"] > 0], [_compare_filter(0, ">", 0)])]}

    for df_name, keys, expected_params in cases:
        wrapped_keys = [
            {"column_index": index, "ascending": ascending} for index, ascending in keys
        ]
        df = tables[df_name]

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
            "b": np.arange(10),
            "c": np.arange(10),
            "d": np.arange(10),
            "e": np.arange(10),
        }
    )
    _assign_variables(shell, variables_comm, df=df)
    _open_viewer(variables_comm, ["df"])

    # Sort a column that is out of bounds for the table after the
    # schema change below
    dxf.set_sort_columns("df", [{"column_index": 4, "ascending": True}])

    expected_df = df[["a", "b"]]
    dxf.register_table("expected_df", df)

    # Sort last column, and we will then change the schema
    shell.run_cell("df = df[['a', 'b']]")
    _check_update_variable(de_service, "df", update_type="schema", discard_state=True)

    # Call get_data_values and make sure it works
    dxf.compare_tables("df", "expected_df", expected_df.shape)


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

    # Test profiling with filter
    # format: (table, filters, filtered_table, profiles)
    filter_cases = [(df1, [_filter("not_null", 0)], df1[df1["a"].notnull()], all_profiles)]
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
        _assert_close(value, float(actual.get(attr)))


def _assert_string_stats_equal(expected, actual):
    assert expected["num_empty"] == actual["num_empty"]
    assert expected["num_unique"] == actual["num_unique"]


def _assert_boolean_stats_equal(expected, actual):
    assert expected["true_count"] == actual["true_count"]
    assert expected["false_count"] == actual["false_count"]


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
        }
    )
    dxf.register_table("df1", df1)

    cases = [
        (
            "df1",
            0,
            {
                "min_value": arr.min(),
                "max_value": arr.max(),
                "mean": df1["a"].mean(),
                "stdev": df1["a"].std(),
                "median": df1["a"].median(),
            },
        ),
        (
            "df1",
            1,
            {
                "min_value": df1["b"].min(),
                "max_value": df1["b"].max(),
                "mean": df1["b"].mean(),
                "stdev": df1["b"].std(),
                "median": df1["b"].median(),
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
    ]

    for table_name, col_index, ex_result in cases:
        profiles = [_get_summary_stats(col_index)]
        results = dxf.get_column_profiles(table_name, profiles)

        stats = results[0]["summary_stats"]
        ui_type = stats["type_display"]

        if ui_type == ColumnDisplayType.Number:
            _assert_numeric_stats_equal(ex_result, stats["number_stats"])
        elif ui_type == ColumnDisplayType.String:
            _assert_string_stats_equal(ex_result, stats["string_stats"])
        elif ui_type == ColumnDisplayType.Boolean:
            _assert_boolean_stats_equal(ex_result, stats["boolean_stats"])


# ----------------------------------------------------------------------
# Test RPCs for polars DataFrame


# ----------------------------------------------------------------------
# Test RPCs for pyarrow Table

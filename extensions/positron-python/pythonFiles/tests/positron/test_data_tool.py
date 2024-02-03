#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
#

import uuid
from dataclasses import asdict
from typing import Any, Dict, List, Optional, cast

import numpy as np
import pandas as pd
import pytest

from positron.data_tool import DataToolService, PandasView, COMPARE_OPS
from positron.data_tool_comm import (
    ColumnSchema,
    FilterResult,
)

from .conftest import DummyComm
from .utils import json_rpc_request

TARGET_NAME = "positron.dataTool"

# ----------------------------------------------------------------------
# pytest fixtures


def guid():
    return str(uuid.uuid4())


@pytest.fixture()
def service() -> DataToolService:
    """
    The Positron dataviewer service.
    """
    return DataToolService(TARGET_NAME)


def get_new_comm(
    service: DataToolService,
    table: Any,
    title: str,
    comm_id: Optional[str] = None,
) -> DummyComm:
    """

    A comm corresponding to a test dataset belonging to the Positron dataviewer service.
    """
    if comm_id is None:
        comm_id = guid()
    service.register_table(table, title, comm_id=comm_id)

    # Clear any existing messages
    new_comm = cast(DummyComm, service.comms[comm_id])
    new_comm.messages.clear()
    return new_comm


def get_last_message(service: DataToolService, comm_id: str):
    comm = cast(DummyComm, service.comms[comm_id].comm)
    return comm.messages[-1]


# ----------------------------------------------------------------------
# Test basic service functionality


def test_service_properties(service: DataToolService):
    assert service.comm_target == TARGET_NAME


def test_register_table(service: DataToolService):
    df = pd.DataFrame({"a": [1, 2, 3, 4, 5]})
    comm_id = guid()

    service.register_table(df, "test_table", comm_id=comm_id)

    assert comm_id in service.comms
    table_view = cast(PandasView, service.tables[comm_id])
    assert table_view.table is df


def test_deregister_table(service: DataToolService):
    df = pd.DataFrame({"a": [1, 2, 3, 4, 5]})
    comm_id = guid()
    service.register_table(df, "test_table", comm_id=comm_id)
    service.deregister_table(comm_id)

    assert len(service.comms) == 0
    assert len(service.tables) == 0


def test_shutdown(service: DataToolService):
    df = pd.DataFrame({"a": [1, 2, 3, 4, 5]})
    service.register_table(df, "t1", comm_id=guid())
    service.register_table(df, "t2", comm_id=guid())
    service.register_table(df, "t3", comm_id=guid())

    service.shutdown()
    assert len(service.comms) == 0
    assert len(service.tables) == 0


# ----------------------------------------------------------------------
# Test RPCs for pandas DataFrame


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
    }
)

JsonRecords = List[Dict[str, Any]]


class PandasFixture:
    def __init__(self, service: DataToolService):
        self.service = service
        self._table_ids = {}

        self.register_table("simple", SIMPLE_PANDAS_DF)

    def register_table(self, table_name: str, table):
        comm_id = guid()
        self.service.register_table(table, table_name, comm_id=comm_id)
        self._table_ids[table_name] = comm_id

    def do_json_rpc(self, table_name, method, **params):
        comm_id = self._table_ids[table_name]
        request = json_rpc_request(
            method,
            params=params,
            comm_id=comm_id,
        )
        self.service.handle_msg(request)
        response = get_last_message(self.service, comm_id)
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

    def get_data_values(self, table_name, **params):
        return self.do_json_rpc(table_name, "get_data_values", **params)

    def set_column_filters(self, table_name, filters=None):
        return self.do_json_rpc(table_name, "set_column_filters", filters=filters)

    def set_sort_columns(self, table_name, sort_keys=None):
        return self.do_json_rpc(table_name, "set_sort_columns", sort_keys=sort_keys)

    def check_filter_case(self, table, filter_set, expected_table):
        table_id = guid()
        ex_id = guid()
        self.register_table(table_id, table)
        self.register_table(ex_id, expected_table)

        response = self.set_column_filters(table_id, filters=filter_set)
        assert response == FilterResult(selected_num_rows=len(expected_table))
        self.compare_tables(table_id, ex_id, table.shape)

    def check_sort_case(self, table, sort_keys, expected_table, filters=None):
        table_id = guid()
        ex_id = guid()
        self.register_table(table_id, table)
        self.register_table(ex_id, expected_table)

        if filters is not None:
            self.set_column_filters(table_id, filters)

        response = self.set_sort_columns(table_id, sort_keys=sort_keys)
        assert response == None
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
def pandas_fixture(service: DataToolService):
    return PandasFixture(service)


def _wrap_json(dataklass, data: JsonRecords):
    return [asdict(dataklass(**d)) for d in data]


def test_pandas_get_schema(pandas_fixture: PandasFixture):
    result = pandas_fixture.get_schema("simple", 0, 100)
    assert result["num_rows"] == 5
    assert result["total_num_columns"] == 5

    full_schema = [
        {
            "column_name": "a",
            "type_name": "int64",
            "type_display": "number",
        },
        {
            "column_name": "b",
            "type_name": "boolean",
            "type_display": "boolean",
        },
        {
            "column_name": "c",
            "type_name": "string",
            "type_display": "string",
        },
        {
            "column_name": "d",
            "type_name": "float64",
            "type_display": "number",
        },
        {
            "column_name": "e",
            "type_name": "datetime64[ns]",
            "type_display": "datetime",
        },
    ]

    assert result["columns"] == _wrap_json(ColumnSchema, full_schema)

    result = pandas_fixture.get_schema("simple", 2, 100)
    assert result["num_rows"] == 5
    assert result["total_num_columns"] == 5

    assert result["columns"] == _wrap_json(ColumnSchema, full_schema[2:])

    result = pandas_fixture.get_schema("simple", 5, 100)
    assert result["num_rows"] == 5
    assert result["total_num_columns"] == 5

    assert result["columns"] == []

    # Make a really big schema
    bigger_df = pd.concat([SIMPLE_PANDAS_DF] * 100, axis="columns")
    bigger_name = guid()
    bigger_schema = full_schema * 100
    pandas_fixture.register_table(bigger_name, bigger_df)

    result = pandas_fixture.get_schema(bigger_name, 0, 100)
    assert result["num_rows"] == 5
    assert result["total_num_columns"] == 500
    assert result["columns"] == _wrap_json(ColumnSchema, bigger_schema[:100])

    result = pandas_fixture.get_schema(bigger_name, 10, 10)
    assert result["num_rows"] == 5
    assert result["total_num_columns"] == 500
    assert result["columns"] == _wrap_json(ColumnSchema, bigger_schema[10:20])


def _trim_whitespace(columns):
    return [[x.strip() for x in column] for column in columns]


def test_pandas_get_data_values(pandas_fixture: PandasFixture):
    result = pandas_fixture.get_data_values(
        "simple",
        row_start_index=0,
        num_rows=20,
        column_indices=list(range(5)),
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
    ]

    assert _trim_whitespace(result["columns"]) == expected_columns

    assert result["row_labels"] == [["0", "1", "2", "3", "4"]]

    # Edge cases: request beyond end of table
    response = pandas_fixture.get_data_values(
        "simple", row_start_index=5, num_rows=10, column_indices=[0]
    )
    assert response["columns"] == [[]]

    # Issue #2149 -- return empty result when requesting non-existent
    # column indices
    response = pandas_fixture.get_data_values(
        "simple", row_start_index=0, num_rows=5, column_indices=[2, 3, 4, 5]
    )
    assert _trim_whitespace(response["columns"]) == expected_columns[2:]

    # Edge case: request invalid column index
    # Per issue #2149, until we can align on whether the UI is allowed
    # to request non-existent column indices, disable this test

    # with pytest.raises(IndexError):
    #     pandas_fixture.get_data_values(
    #         "simple", row_start_index=0, num_rows=10, column_indices=[4]
    #     )


def _filter(filter_type, column_index, **kwargs):
    kwargs.update(
        {
            "filter_id": guid(),
            "filter_type": filter_type,
            "column_index": column_index,
        }
    )
    return kwargs


def _compare_filter(column_index, compare_op, compare_value):
    return _filter(
        "compare",
        column_index,
        compare_op=compare_op,
        compare_value=compare_value,
    )


def _set_member_filter(column_index, values, inclusive=True):
    return _filter(
        "set_membership",
        column_index,
        set_member_inclusive=inclusive,
        set_member_values=values,
    )


def test_pandas_filter_compare(pandas_fixture: PandasFixture):
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
        pandas_fixture.check_filter_case(df, [filt], expected_df)

    # Test that passing empty filter set resets to unfiltered state
    filt = _compare_filter(column_index, "<", str(compare_value))
    _ = pandas_fixture.set_column_filters(table_name, filters=[filt])
    response = pandas_fixture.set_column_filters(table_name, filters=[])
    assert response == FilterResult(selected_num_rows=len(df))

    # register the whole table to make sure the filters are really cleared
    ex_id = guid()
    pandas_fixture.register_table(ex_id, df)
    pandas_fixture.compare_tables(table_name, ex_id, df.shape)


def test_pandas_filter_isnull_notnull(pandas_fixture: PandasFixture):
    df = SIMPLE_PANDAS_DF
    b_isnull = _filter("isnull", 1)
    b_notnull = _filter("notnull", 1)
    c_notnull = _filter("notnull", 2)

    cases = [
        [[b_isnull], df[df["b"].isnull()]],
        [[b_notnull], df[df["b"].notnull()]],
        [[b_notnull, c_notnull], df[df["b"].notnull() & df["c"].notnull()]],
    ]

    for filter_set, expected_df in cases:
        pandas_fixture.check_filter_case(df, filter_set, expected_df)


def test_pandas_filter_set_membership(pandas_fixture: PandasFixture):
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
        pandas_fixture.check_filter_case(df, filter_set, expected_df)


def test_pandas_set_sort_columns(pandas_fixture: PandasFixture):
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

        pandas_fixture.check_sort_case(df, wrapped_keys, expected_df)

        for filter_f, filters in filter_cases.get(df_name, []):
            expected_filtered = filter_f(df).sort_values(**expected_params)
            pandas_fixture.check_sort_case(df, wrapped_keys, expected_filtered, filters=filters)


# def test_pandas_get_column_profile(pandas_fixture: PandasFixture):
#     pass


# def test_pandas_get_state(pandas_fixture: PandasFixture):
#     pass


# ----------------------------------------------------------------------
# Test RPCs for polars DataFrame


# ----------------------------------------------------------------------
# Test RPCs for pyarrow Table

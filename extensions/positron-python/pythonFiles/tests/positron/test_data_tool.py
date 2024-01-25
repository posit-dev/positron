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
    ColumnFilter,
    ColumnFilterCompareOp,
    ColumnFilterFilterType,
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
        return response["data"]["result"]

    def get_schema(self, table_name):
        return self.do_json_rpc(table_name, "get_schema")

    def get_data_values(self, table_name, **params):
        return self.do_json_rpc(table_name, "get_data_values", **params)

    def set_column_filters(self, table_name, filters=None):
        return self.do_json_rpc(table_name, "set_column_filters", filters=filters)

    def check_filter_case(self, table, filter_set, expected_table):
        table_id = guid()
        ex_id = guid()
        self.register_table(table_id, table)
        self.register_table(ex_id, expected_table)

        response = self.set_column_filters(table_id, filters=filter_set)
        assert response == FilterResult(selected_num_rows=len(expected_table))
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
    result = pandas_fixture.get_schema("simple")
    assert result["num_rows"] == 5

    expected_schema = _wrap_json(
        ColumnSchema,
        [
            {"name": "a", "type_name": "int64"},
            {"name": "b", "type_name": "boolean"},
            {"name": "c", "type_name": "string"},
            {"name": "d", "type_name": "float64"},
        ],
    )

    assert result["columns"] == expected_schema


def test_pandas_get_data_values(pandas_fixture: PandasFixture):
    result = pandas_fixture.get_data_values(
        "simple",
        row_start_index=0,
        num_rows=20,
        column_indices=list(range(4)),
    )

    # TODO: These values are not what a pandas user would see in the
    # console or in Jupyter, need to spelunk and fix that to be
    # consistent
    expected_columns = [
        ["1", "2", "3", "4", "5"],
        ["True", "False", "True", "None", "True"],
        ["foo", "bar", "None", "bar", "qux"],
        ["0.0", "1.2", "-4.5", "6.0", "nan"],
    ]

    assert result["columns"] == expected_columns

    # TODO(wesm): for later
    assert result["row_labels"] == []

    # Edge case: request beyond end of table
    response = pandas_fixture.get_data_values(
        "simple", row_start_index=5, num_rows=10, column_indices=[0]
    )
    assert response["columns"] == [[]]

    # Edge case: request invalid column index
    with pytest.raises(IndexError):
        pandas_fixture.get_data_values("simple", row_start_index=0, num_rows=10, column_indices=[4])


def _get_compare_filter(filter_type, column_index, compare_op, compare_value):
    if isinstance(compare_op, str):
        compare_op = ColumnFilterCompareOp(compare_op)

    return ColumnFilter(
        guid(),
        ColumnFilterFilterType(filter_type),
        column_index=column_index,
        compare_op=compare_op,
        compare_value=compare_value,
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
        filt = _get_compare_filter("compare", column_index, op, str(compare_value))
        expected_df = df[op_func(df[column], compare_value)]
        pandas_fixture.check_filter_case(df, [filt], expected_df)

    # Test that passing empty filter set resets to unfiltered state
    filt = _get_compare_filter("compare", column_index, "<", str(compare_value))
    _ = pandas_fixture.set_column_filters(table_name, filters=[filt])
    response = pandas_fixture.set_column_filters(table_name, filters=[])
    assert response == FilterResult(selected_num_rows=len(df))

    # register the whole table to make sure the filters are really cleared
    ex_id = guid()
    pandas_fixture.register_table(ex_id, df)
    pandas_fixture.compare_tables(table_name, ex_id, df.shape)


def test_pandas_filter_isnull_notnull(pandas_fixture: PandasFixture):
    df = SIMPLE_PANDAS_DF
    b_isnull = ColumnFilter(guid(), ColumnFilterFilterType.Isnull, column_index=1)
    b_notnull = ColumnFilter(guid(), ColumnFilterFilterType.Notnull, column_index=1)
    c_notnull = ColumnFilter(guid(), ColumnFilterFilterType.Notnull, column_index=2)

    cases = [
        [[b_isnull], df[df["b"].isnull()]],
        [[b_notnull], df[df["b"].notnull()]],
        [[b_notnull, c_notnull], df[df["b"].notnull() & df["c"].notnull()]],
    ]

    for filter_set, expected_df in cases:
        pandas_fixture.check_filter_case(df, filter_set, expected_df)


def test_pandas_filter_set_membership(pandas_fixture: PandasFixture):
    df = SIMPLE_PANDAS_DF

    def _set_member(column_index, values, inclusive=True):
        return ColumnFilter(
            guid(),
            ColumnFilterFilterType.SetMembership,
            column_index=column_index,
            set_member_inclusive=inclusive,
            set_member_values=values,
        )

    cases = [
        [[_set_member(0, [2, 4])], df[df["a"].isin([2, 4])]],
        [[_set_member(2, ["bar", "foo"])], df[df["c"].isin(["bar", "foo"])]],
        [[_set_member(2, [])], df[df["c"].isin([])]],
        [[_set_member(2, ["bar"], False)], df[~df["c"].isin(["bar"])]],
        [[_set_member(2, [], False)], df],
    ]

    for filter_set, expected_df in cases:
        pandas_fixture.check_filter_case(df, filter_set, expected_df)


# def test_pandas_set_sort_keys(pandas_fixture: PandasFixture):
#     pass


# def test_pandas_get_column_profile(pandas_fixture: PandasFixture):
#     pass


# def test_pandas_get_state(pandas_fixture: PandasFixture):
#     pass


# ----------------------------------------------------------------------
# Test RPCs for polars DataFrame


# ----------------------------------------------------------------------
# Test RPCs for pyarrow Table

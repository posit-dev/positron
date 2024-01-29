#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
#

# flake8: ignore E203
# pyright: reportOptionalMemberAccess=false

from typing import TYPE_CHECKING, Any, Dict, List, Sequence
from .positron_comm import JsonRpcErrorCode, PositronComm
from dataclasses import asdict
from .data_tool_comm import (
    BackendState,
    ColumnFilter,
    ColumnFilterCompareOp,
    ColumnSchema,
    ColumnSchemaTypeDisplay,
    ColumnSortKey,
    DataToolBackendRequest,
    FilterResult,
    GetColumnProfileProfileType,
    GetDataValuesRequest,
    GetColumnProfileRequest,
    GetSchemaRequest,
    GetStateRequest,
    SetColumnFiltersRequest,
    SetSortColumnsRequest,
    TableData,
    TableSchema,
)
import comm
import logging
import operator
import uuid

if TYPE_CHECKING:
    import pandas as pd

    # import polars as pl
    # import pyarrow as pa


logger = logging.getLogger(__name__)


class DataToolTableView:
    """
    Interface providing a consistent wrapper around different data
    frame / table types for the data tool for serving requests from
    the front end. This includes pandas.DataFrame, polars.DataFrame,
    pyarrow.Table, and any others
    """

    def __init__(self, table):
        # Note: we must not ever modify the user's data
        self.table = table

        self.applied_filters: List[ColumnFilter] = []
        self.applied_sort_keys: List[ColumnSortKey] = []

        # NumPy array of selected ("true") indices using filters. If
        # there are also sort keys, we first filter the unsorted data,
        # and then sort the filtered data only, for the optimistic
        # case that a low-selectivity filters yields less data to sort
        self.filtered_indices = None

        # NumPy array of selected AND reordered indices
        # (e.g. including any sorting). If there are no sort keys and
        # only filters, then this should be the same as
        # self.filtered_indices
        self.view_indices = None

    def get_schema(self, data: Dict[str, Any]):
        req = GetSchemaRequest(**data)
        return asdict(self._get_schema(req.params.start_index, req.params.num_columns))

    def get_data_values(self, data: Dict[str, Any]):
        req = GetDataValuesRequest(**data)
        return asdict(
            self._get_data_values(
                req.params.row_start_index,
                req.params.num_rows,
                req.params.column_indices,
            )
        )

    def set_column_filters(self, data: Dict[str, Any]):
        req = SetColumnFiltersRequest(**data)
        return self._set_column_filters(req.params.filters)

    def set_sort_columns(self, data: Dict[str, Any]):
        req = SetSortColumnsRequest(**data)
        return self._set_sort_columns(req.params.sort_keys)

    def get_column_profile(self, data: Dict[str, Any]):
        req = GetColumnProfileRequest(**data)
        return self._get_column_profile(req.params.profile_type, req.params.column_index)

    def get_state(self, data: Dict[str, Any]):
        GetStateRequest(**data)
        return self._get_state()

    def _get_schema(self, column_start: int, num_columns: int) -> TableSchema:
        raise NotImplementedError

    def _get_data_values(
        self, row_start: int, num_rows: int, column_indices: Sequence[int]
    ) -> TableData:
        raise NotImplementedError

    def _set_column_filters(self, filters: List[ColumnFilter]) -> FilterResult:
        raise NotImplementedError

    def _set_sort_columns(self, sort_keys: List[ColumnSortKey]) -> None:
        raise NotImplementedError

    def _get_column_profile(
        self, profile_type: GetColumnProfileProfileType, column_index: int
    ) -> None:
        raise NotImplementedError

    def _get_state(self) -> BackendState:
        raise NotImplementedError


class PandasView(DataToolTableView):
    TYPE_DISPLAY_MAPPING = {
        "integer": "number",
        "int8": "number",
        "int16": "number",
        "int32": "number",
        "int64": "number",
        "uint8": "number",
        "uint16": "number",
        "uint32": "number",
        "uint64": "number",
        "floating": "number",
        "float16": "number",
        "float32": "number",
        "float64": "number",
        "mixed-integer": "number",
        "mixed-integer-float": "number",
        "decimal": "number",
        "complex": "number",
        "categorical": "categorical",
        "boolean": "boolean",
        "datetime64": "datetime",
        "datetime": "datetime",
        "date": "date",
        "time": "time",
        "bytes": "string",
        "string": "string",
    }

    def __init__(self, table):
        super().__init__(table)

        # Compute and cache this once. If the data frame is changed,
        # this must be reset
        self._dtypes = table.dtypes

        # Maintain a mapping of column index to inferred dtype for any
        # object columns, to avoid recomputing. If the underlying
        # object is changed, this needs to be reset
        self._inferred_dtypes = {}

    def _get_schema(self, column_start: int, num_columns: int) -> TableSchema:
        from pandas.api.types import infer_dtype

        # TODO: pandas MultiIndex columns
        # TODO: time zone for datetimetz datetime64[ns] types
        columns_slice = self.table.columns[column_start : column_start + num_columns]
        dtypes_slice = self._dtypes.iloc[column_start : column_start + num_columns]
        column_schemas = []

        for i, (c, dtype) in enumerate(zip(columns_slice, dtypes_slice)):
            if dtype == object:
                column_index = i + column_start
                if i not in self._inferred_dtypes:
                    self._inferred_dtypes[column_index] = infer_dtype(
                        self.table.iloc[:, column_index]
                    )
                type_name = self._inferred_dtypes[column_index]
            else:
                # TODO: more sophisticated type mapping
                type_name = str(dtype)

            type_display = self.TYPE_DISPLAY_MAPPING.get(type_name, "unknown")

            col_schema = ColumnSchema(
                column_name=str(c),
                type_name=type_name,
                type_display=ColumnSchemaTypeDisplay(type_display),
            )
            column_schemas.append(col_schema)
        return TableSchema(column_schemas, *self.table.shape)

    def _get_data_values(
        self, row_start: int, num_rows: int, column_indices: Sequence[int]
    ) -> TableData:
        formatted_columns = []

        column_indices = sorted(column_indices)

        # TODO(wesm): This value formatting strategy produces output
        # that is not the same as what users see in the console. I
        # will have to look for the right pandas function that deals
        # with value formatting
        for i in column_indices:
            # The UI has requested data beyond the end of the table,
            # so we stop here
            if i >= len(self.table.columns):
                break
            col = self.table.iloc[:, i]

            # If the table is either filtered or sorted, view_indices
            if self.view_indices is not None:
                value_slice = col.take(self.view_indices[row_start : row_start + num_rows])
            else:
                value_slice = col.iloc[row_start : row_start + num_rows]

            formatted_columns.append(value_slice.astype(str).tolist())

        # TODO: handle pandas.Index, pandas.MultiIndex
        row_labels = []
        return TableData(formatted_columns, row_labels)

    def _format_value_slice(self, values):
        from pandas.io.formats.format import format_array

        return format_array(values, None, leading_space=False)

    def _update_view_indices(self):
        if len(self.applied_sort_keys) == 0:
            self.view_indices = self.filtered_indices
        else:
            self._set_sort_columns(self.applied_sort_keys)

    def _set_column_filters(self, filters: List[ColumnFilter]) -> FilterResult:
        self.applied_filters = filters

        if len(filters) == 0:
            # Simply reset if empty filter set passed
            self.filtered_indices = None
            self._update_view_indices()
            return FilterResult(len(self.table))

        combined_mask = None
        for filt in filters:
            single_mask = _pandas_eval_filter(self.table, filt)
            if combined_mask is None:
                combined_mask = single_mask
            else:
                combined_mask &= single_mask

        self.filtered_indices = combined_mask.nonzero()[0]

        # Update the view indices, re-sorting if needed
        self._update_view_indices()
        return FilterResult(len(self.filtered_indices))

    def _set_sort_columns(self, sort_keys: List[ColumnSortKey]) -> None:
        # from pandas.core.sorting import lexsort_indexer, nargsort

        self.applied_sort_keys = []
        if len(sort_keys) == 0:
            pass
        elif len(sort_keys) == 1:
            pass
        else:
            pass

    def _get_column_profile(
        self, profile_type: GetColumnProfileProfileType, column_index: int
    ) -> None:
        pass

    def _get_state(self) -> BackendState:
        return BackendState(self.applied_filters, self.applied_sort_keys)


COMPARE_OPS = {
    ColumnFilterCompareOp.Gt: operator.gt,
    ColumnFilterCompareOp.GtEq: operator.ge,
    ColumnFilterCompareOp.Lt: operator.lt,
    ColumnFilterCompareOp.LtEq: operator.le,
    ColumnFilterCompareOp.Eq: operator.eq,
    ColumnFilterCompareOp.NotEq: operator.ne,
}


def _pandas_eval_filter(df: "pd.DataFrame", filt: ColumnFilter):
    import pandas as pd

    col = df.iloc[:, filt.column_index]
    mask = None
    if filt.filter_type == "compare":
        if filt.compare_op not in COMPARE_OPS:
            raise ValueError(f"Unsupported filter type: {filt.compare_op}")
        op = COMPARE_OPS[filt.compare_op]
        # Let pandas decide how to coerce the string we got from the UI
        dummy = pd.Series([filt.compare_value]).astype(col.dtype)

        # pandas comparison filters return False for null values
        mask = op(col, dummy.iloc[0])
    elif filt.filter_type == "isnull":
        mask = col.isnull()
    elif filt.filter_type == "notnull":
        mask = col.notnull()
    elif filt.filter_type == "set_membership":
        boxed_values = pd.Series(filt.set_member_values).astype(col.dtype)
        # IN
        mask = col.isin(boxed_values)
        if not filt.set_member_inclusive:
            # NOT-IN
            mask = ~mask
    elif filt.filter_type == "search":
        raise NotImplementedError

    # TODO(wesm): is it possible for there to be null values in the mask?
    return mask.to_numpy()


class PolarsView(DataToolTableView):
    pass


class PyArrowView(DataToolTableView):
    pass


def _wrap_table(table):
    return PandasView(table)


class DataToolService:
    def __init__(self, comm_target: str) -> None:
        self.comm_target = comm_target

        # Maps comm_id for each dataset being viewed to PositronComm
        self.comms: Dict[str, PositronComm] = {}
        self.tables: Dict[str, DataToolTableView] = {}

    def shutdown(self) -> None:
        for table_comm in self.comms.values():
            try:
                table_comm.close()
            except Exception:
                # TODO: shouldn't this raise?
                pass
        self.comms.clear()
        self.tables.clear()

    def register_table(self, table, title, comm_id=None):
        if type(table).__name__ != "DataFrame":
            raise TypeError(type(table))

        if comm_id is None:
            comm_id = str(uuid.uuid4())
        self.tables[comm_id] = _wrap_table(table)
        table_comm = comm.create_comm(
            target_name=self.comm_target,
            comm_id=comm_id,
            data={"title": title},
        )
        self.comms[comm_id] = PositronComm(table_comm)
        table_comm.on_msg(self.handle_msg)

    def deregister_table(self, comm_id: str):
        comm = self.comms.pop(comm_id)
        try:
            comm.close()
        except Exception:
            # Shouldn't this raise?
            pass
        del self.tables[comm_id]

    def handle_msg(self, msg: Dict[str, Any]) -> None:
        """
        Handle messages received from the client via the
        positron.data_tool comm.
        """
        data = msg["content"]["data"]

        comm_id = msg["content"]["comm_id"]
        comm = self.comms[comm_id]

        # TODO(wesm): method validation should take place more
        # centrally. There is also code like this for the other
        # OpenRPC-based comms
        method_name = data.get("method", None)
        try:
            method = DataToolBackendRequest(method_name)
        except ValueError:
            comm.send_error(
                JsonRpcErrorCode.METHOD_NOT_FOUND,
                f"Unknown method '{data.get('method')}'",
            )
            return

        table = self.tables[comm_id]

        try:
            result = getattr(table, method.value)(data)
            comm.send_result(result)
        except TypeError as e:
            comm.send_error(
                JsonRpcErrorCode.INVALID_REQUEST,
                message=f"Invalid {method_name} request {data}: {e}",
            )

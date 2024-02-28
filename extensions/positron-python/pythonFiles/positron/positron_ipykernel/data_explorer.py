#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
#

# flake8: ignore E203
# pyright: reportOptionalMemberAccess=false

import logging
import operator
import uuid
from typing import (
    TYPE_CHECKING,
    Callable,
    Dict,
    List,
    Optional,
    Sequence,
    Set,
    Tuple,
)

import comm

from .access_keys import decode_access_key
from .data_explorer_comm import (
    ColumnFilter,
    ColumnFilterCompareOp,
    ColumnSchema,
    ColumnSchemaTypeDisplay,
    ColumnSortKey,
    DataExplorerBackendMessageContent,
    DataExplorerFrontendEvent,
    FilterResult,
    GetColumnProfileProfileType,
    GetColumnProfileRequest,
    GetDataValuesRequest,
    GetSchemaRequest,
    GetStateRequest,
    SchemaUpdateParams,
    SetColumnFiltersRequest,
    SetSortColumnsRequest,
    TableData,
    TableSchema,
    TableShape,
    TableState,
)
from .positron_comm import CommMessage, PositronComm
from .third_party import pd_

if TYPE_CHECKING:
    import pandas as pd

    # import polars as pl
    # import pyarrow as pa


logger = logging.getLogger(__name__)


PathKey = Tuple[str, ...]


class DataExplorerTableView:
    """
    Interface providing a consistent wrapper around different data
    frame / table types for the data explorer for serving requests from
    the front end. This includes pandas.DataFrame, polars.DataFrame,
    pyarrow.Table, and any others
    """

    def __init__(
        self,
        table,
        filters: Optional[List[ColumnFilter]],
        sort_keys: Optional[List[ColumnSortKey]],
    ):
        # Note: we must not ever modify the user's data
        self.table = table

        self.filters = filters if filters is not None else []
        self.sort_keys = sort_keys if sort_keys is not None else []

        self._need_recompute = len(self.filters) > 0 or len(self.sort_keys) > 0

    def invalidate_computations(self):
        raise NotImplementedError

    def ui_should_update_schema(self, new_table):
        raise NotImplementedError

    def ui_should_update_data(self, new_table):
        raise NotImplementedError

    def _recompute_if_needed(self) -> bool:
        if self._need_recompute:
            self._recompute()
            self._need_recompute = False
            return True
        else:
            return False

    def _recompute(self):
        raise NotImplementedError

    def get_schema(self, request: GetSchemaRequest):
        return self._get_schema(request.params.start_index, request.params.num_columns).dict()

    def get_data_values(self, request: GetDataValuesRequest):
        self._recompute_if_needed()
        return self._get_data_values(
            request.params.row_start_index,
            request.params.num_rows,
            request.params.column_indices,
        ).dict()

    def set_column_filters(self, request: SetColumnFiltersRequest):
        return self._set_column_filters(request.params.filters)

    def set_sort_columns(self, request: SetSortColumnsRequest):
        self.sort_keys = request.params.sort_keys

        if not self._recompute_if_needed():
            # If a re-filter is pending, then it will automatically
            # trigger a sort
            self._sort_data()

    def get_column_profile(self, request: GetColumnProfileRequest):
        self._recompute_if_needed()
        return self._get_column_profile(request.params.profile_type, request.params.column_index)

    def get_state(self, request: GetStateRequest):
        return self._get_state().dict()

    def _get_schema(self, column_start: int, num_columns: int) -> TableSchema:
        raise NotImplementedError

    def _get_data_values(
        self,
        row_start: int,
        num_rows: int,
        column_indices: Sequence[int],
    ) -> TableData:
        raise NotImplementedError

    def _set_column_filters(self, filters: List[ColumnFilter]) -> FilterResult:
        raise NotImplementedError

    def _sort_data(self) -> None:
        raise NotImplementedError

    def _get_column_profile(
        self,
        profile_type: GetColumnProfileProfileType,
        column_index: int,
    ) -> None:
        raise NotImplementedError

    def _get_state(self) -> TableState:
        raise NotImplementedError


def _pandas_format_values(col):
    import pandas.io.formats.format as fmt

    try:
        return fmt.format_array(col._values, None, leading_space=False)
    except Exception:
        logger.warning(f"Failed to format column '{col.name}'")
        return col.astype(str).tolist()


class PandasView(DataExplorerTableView):
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
        "mixed": "unknown",
        "decimal": "number",
        "complex": "number",
        "categorical": "categorical",
        "boolean": "boolean",
        "datetime64": "datetime",
        "datetime64[ns]": "datetime",
        "datetime": "datetime",
        "date": "date",
        "time": "time",
        "bytes": "string",
        "string": "string",
    }

    def __init__(
        self,
        table,
        filters: Optional[List[ColumnFilter]],
        sort_keys: Optional[List[ColumnSortKey]],
    ):
        super().__init__(table, filters, sort_keys)

        self._dtypes = None

        # Maintain a mapping of column index to inferred dtype for any
        # object columns, to avoid recomputing. If the underlying
        # object is changed, this needs to be reset
        self._inferred_dtypes = {}

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

    def invalidate_computations(self):
        self.filtered_indices = self.view_indices = None
        self._need_recompute = True

    def ui_should_update_schema(self, new_table) -> Tuple[bool, bool]:
        # Add smarter logic here later, but for now always update the
        # schema

        if self.table.columns.equals(new_table.columns):
            update_schema = False
            for i in range(len(self.table.columns)):
                if self.table.iloc[:, i].dtype != new_table.iloc[:, i].dtype:
                    update_schema = True
                    break
        else:
            update_schema = True

        discard_state = update_schema
        return update_schema, discard_state

    def ui_should_update_data(self, new_table):
        # If the variables service says the variable has been updated
        # or is uncertain
        return True

    def _recompute(self):
        # Resetting the column filters will trigger filtering AND
        # sorting
        self._set_column_filters(self.filters)

    @property
    def dtypes(self):
        if self._dtypes is None:
            self._dtypes = self.table.dtypes
        return self._dtypes

    def _get_schema(self, column_start: int, num_columns: int) -> TableSchema:
        from pandas.api.types import infer_dtype

        # TODO: pandas MultiIndex columns
        # TODO: time zone for datetimetz datetime64[ns] types
        columns_slice = self.table.columns[column_start : column_start + num_columns]
        dtypes_slice = self.dtypes.iloc[column_start : column_start + num_columns]
        column_schemas = []

        for i, (c, dtype) in enumerate(zip(columns_slice, dtypes_slice)):
            if dtype == object:
                column_index = i + column_start
                if column_index not in self._inferred_dtypes:
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

        return TableSchema(columns=column_schemas)

    def _get_data_values(
        self, row_start: int, num_rows: int, column_indices: Sequence[int]
    ) -> TableData:
        formatted_columns = []

        column_indices = sorted(column_indices)

        # TODO(wesm): This value formatting strategy produces output
        # that is not the same as what users see in the console. I
        # will have to look for the right pandas function that deals
        # with value formatting
        columns = []
        for i in column_indices:
            # The UI has requested data beyond the end of the table,
            # so we stop here
            if i >= len(self.table.columns):
                break
            columns.append(self.table.iloc[:, i])

        formatted_columns = []

        if self.view_indices is not None:
            # If the table is either filtered or sorted, use a slice
            # the view_indices to select the virtual range of values for the grid
            view_slice = self.view_indices[row_start : row_start + num_rows]
            columns = [col.take(view_slice) for col in columns]
            indices = self.table.index.take(view_slice)
        else:
            # No filtering or sorting, just slice directly
            indices = self.table.index[row_start : row_start + num_rows]
            columns = [col.iloc[row_start : row_start + num_rows] for col in columns]

        formatted_columns = [_pandas_format_values(col) for col in columns]

        # Currently, we format MultiIndex in its flat tuple
        # representation. In the future we will return multiple lists
        # of row labels to be formatted more nicely in the UI
        if isinstance(self.table.index, pd_.MultiIndex):
            indices = indices.to_flat_index()
        row_labels = [_pandas_format_values(indices)]
        return TableData(columns=formatted_columns, row_labels=row_labels)

    def _update_view_indices(self):
        if len(self.sort_keys) == 0:
            self.view_indices = self.filtered_indices
        else:
            # If we have just applied a new filter, we now resort to
            # reflect the filtered_indices that have just been updated
            self._sort_data()

    def _set_column_filters(self, filters) -> FilterResult:
        self.filters = filters

        if len(filters) == 0:
            # Simply reset if empty filter set passed
            self.filtered_indices = None
            self._update_view_indices()
            return FilterResult(selected_num_rows=len(self.table))

        # Evaluate all the filters and AND them together
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
        return FilterResult(selected_num_rows=len(self.filtered_indices))

    def _sort_data(self) -> None:
        from pandas.core.sorting import lexsort_indexer, nargsort

        if len(self.sort_keys) == 1:
            key = self.sort_keys[0]
            column = self.table.iloc[:, key.column_index]
            if self.filtered_indices is not None:
                # pandas's univariate null-friendly argsort (computes
                # the sorting indices). Mergesort is needed to make it
                # stable
                sort_indexer = nargsort(
                    column.take(self.filtered_indices),
                    kind="mergesort",
                    ascending=key.ascending,
                )
                # Reorder the filtered_indices to provide the
                # filtered, sorted virtual view for future data
                # requests
                self.view_indices = self.filtered_indices.take(sort_indexer)
            else:
                # Data is not filtered
                self.view_indices = nargsort(column, kind="mergesort", ascending=key.ascending)
        elif len(self.sort_keys) > 1:
            # Multiple sorting keys
            cols_to_sort = []
            directions = []
            for key in self.sort_keys:
                column = self.table.iloc[:, key.column_index]
                if self.filtered_indices is not None:
                    column = column.take(self.filtered_indices)
                cols_to_sort.append(column)
                directions.append(key.ascending)

            # lexsort_indexer uses np.lexsort and so is always stable
            sort_indexer = lexsort_indexer(cols_to_sort, directions)
            if self.filtered_indices is not None:
                # Create the filtered, sorted virtual view indices
                self.view_indices = self.filtered_indices.take(sort_indexer)
            else:
                self.view_indices = sort_indexer
        else:
            # This will be None if the data is unfiltered
            self.view_indices = self.filtered_indices

    def _get_column_profile(
        self, profile_type: GetColumnProfileProfileType, column_index: int
    ) -> None:
        pass

    def _get_state(self) -> TableState:
        return TableState(
            table_shape=TableShape(num_rows=self.table.shape[0], num_columns=self.table.shape[1]),
            filters=self.filters,
            sort_keys=self.sort_keys,
        )


COMPARE_OPS = {
    ColumnFilterCompareOp.Gt: operator.gt,
    ColumnFilterCompareOp.GtEq: operator.ge,
    ColumnFilterCompareOp.Lt: operator.lt,
    ColumnFilterCompareOp.LtEq: operator.le,
    ColumnFilterCompareOp.Eq: operator.eq,
    ColumnFilterCompareOp.NotEq: operator.ne,
}


def _pandas_eval_filter(df: "pd.DataFrame", filt: ColumnFilter):
    col = df.iloc[:, filt.column_index]
    mask = None
    if filt.filter_type == "compare":
        if filt.compare_op not in COMPARE_OPS:
            raise ValueError(f"Unsupported filter type: {filt.compare_op}")
        op = COMPARE_OPS[filt.compare_op]
        # Let pandas decide how to coerce the string we got from the UI
        dummy = pd_.Series([filt.compare_value]).astype(col.dtype)

        # pandas comparison filters return False for null values
        mask = op(col, dummy.iloc[0])
    elif filt.filter_type == "isnull":
        mask = col.isnull()
    elif filt.filter_type == "notnull":
        mask = col.notnull()
    elif filt.filter_type == "set_membership":
        boxed_values = pd_.Series(filt.set_member_values).astype(col.dtype)
        # IN
        mask = col.isin(boxed_values)
        if not filt.set_member_inclusive:
            # NOT-IN
            mask = ~mask
    elif filt.filter_type == "search":
        raise NotImplementedError

    # TODO(wesm): is it possible for there to be null values in the mask?
    return mask.to_numpy()


class PolarsView(DataExplorerTableView):
    pass


class PyArrowView(DataExplorerTableView):
    pass


def _get_table_view(table, filters=None, sort_keys=None):
    return PandasView(table, filters, sort_keys)


def _value_type_is_supported(value):
    return isinstance(value, pd_.DataFrame)


class DataExplorerService:
    def __init__(self, comm_target: str) -> None:
        self.comm_target = comm_target

        # Maps comm_id for each dataset being viewed to PositronComm
        self.comms: Dict[str, PositronComm] = {}
        self.table_views: Dict[str, DataExplorerTableView] = {}

        # Maps from variable path to set of comm_ids serving DE
        # requests. The user could have multiple DE windows open
        # referencing the same dataset.
        self.path_to_comm_ids: Dict[PathKey, Set[str]] = {}

        # Mapping from comm_id to the corresponding variable path, if any
        self.comm_id_to_path: Dict[str, PathKey] = {}

        # Called when comm closure is initiated from the backend
        self._close_callback = None

    def shutdown(self) -> None:
        for comm_id in list(self.comms.keys()):
            self._close_explorer(comm_id)

    def register_table(
        self,
        table,
        title,
        variable_path: Optional[List[str]] = None,
        comm_id=None,
    ):
        """
        Set up a new comm and data explorer table query wrapper to
        handle requests and manage state.

        Parameters
        ----------
        table : table-like object
        title : str
            Display name in UI
        variable_path : List[str], default None
            If the data explorer references an assigned variable in
            the user namespace, we track it so that namespace changes
            (variable deletions or assignments) can reflect the
            appropriate change on active data explorer tabs and make
            sure e.g. that we do not hold onto memory inappropriately.
        comm_id : str, default None
            A specific comm identifier to use, otherwise generate a
            random uuid.

        Returns
        -------
        comm_id : str
            The associated (generated or passed in) comm_id
        """
        if type(table).__name__ != "DataFrame":
            raise TypeError(type(table))

        if comm_id is None:
            comm_id = str(uuid.uuid4())

        self.table_views[comm_id] = _get_table_view(table)

        base_comm = comm.create_comm(
            target_name=self.comm_target,
            comm_id=comm_id,
            data={"title": title},
        )

        def close_callback(msg):
            # Notify via callback that the comm_id has closed
            if self._close_callback:
                self._close_callback(comm_id)

            self._close_explorer(comm_id)

        base_comm.on_close(close_callback)

        if variable_path is not None:
            if not isinstance(variable_path, list):
                raise ValueError(variable_path)

            key = tuple(variable_path)
            self.comm_id_to_path[comm_id] = key

            if key in self.path_to_comm_ids:
                self.path_to_comm_ids[key].add(comm_id)
            else:
                self.path_to_comm_ids[key] = {comm_id}

        wrapped_comm = PositronComm(base_comm)
        wrapped_comm.on_msg(self.handle_msg, DataExplorerBackendMessageContent)
        self.comms[comm_id] = wrapped_comm

    def _close_explorer(self, comm_id: str):
        try:
            # This is idempotent, so if the comm is already closed, we
            # can call this again. This will also notify the UI with
            # the comm_close event
            self.comms[comm_id].close()
        except Exception as err:
            logger.warning(err, exc_info=True)
            pass

        del self.comms[comm_id]
        del self.table_views[comm_id]

        if comm_id in self.comm_id_to_path:
            path = self.comm_id_to_path[comm_id]
            self.path_to_comm_ids[path].remove(comm_id)
            del self.comm_id_to_path[comm_id]

    def on_comm_closed(self, callback: Callable[[str], None]):
        """
        Register a callback to invoke when a comm was closed in the backend.
        """
        self._close_callback = callback

    def variable_has_active_explorers(self, variable_name):
        # Check if any data explorer has been opened with the indicated
        # variable as a path prefix
        return len(self.get_paths_for_variable(variable_name)) > 0

    def get_paths_for_variable(self, variable_name):
        result = []
        for path, comm_ids in self.path_to_comm_ids.items():
            key = decode_access_key(path[0])
            if key == variable_name and len(comm_ids) > 0:
                # An active data explorer shares a path prefix
                result.append(path)
                continue
        return result

    def handle_variable_deleted(self, variable_name):
        """
        If a variable with active data explorers is deleted, we must
        shut down and delete unneeded state and object references
        stored here.
        """
        affected_paths = self.get_paths_for_variable(variable_name)
        for path in affected_paths:
            for comm_id in list(self.path_to_comm_ids[path]):
                self._close_explorer(comm_id)

    def handle_variable_updated(self, variable_name, new_variable):
        affected_paths = self.get_paths_for_variable(variable_name)
        for path in affected_paths:
            for comm_id in list(self.path_to_comm_ids[path]):
                self._update_explorer_for_comm(comm_id, path, new_variable)

    def _update_explorer_for_comm(self, comm_id: str, path: PathKey, new_variable):
        """
        If a variable is updated, we have to handle the different scenarios:

        * The variable type is the same and the schema is the same,
          but the data is possibly different (e.g. if the object is
          mutable and large, this will happen every time the user
          performs an action). Depending on whether the object
          reference has changed, we can reason about what state needs
          to be invalidated on a case by case basis (for example:
          sort/filter indices will need to be recomputed generally).
        * The variable type is the same and the schema is
          different. Depending on whether the schema or column names
          are different, we may signal the UI to do a "soft" update
          (leaving the cursor position and UI state as is) or a hard
          update (resetting everything to its initial state). We will
          have to do some work to decide whether to preserve filters
          and sorts (if the sorts and filters are still valid after
          the schema change).
        * The variable type is different but still supported in the
          data explorer.
        * The variable type is different and NOT supported in the data
          explorer.
        """
        from .variables import _resolve_value_from_path

        comm = self.comms[comm_id]
        table_view = self.table_views[comm_id]

        # When detecting namespace assignments or changes, the first
        # level of the path has already been resolved. If there is a
        # data explorer open for a nested value, then we need to use
        # the same variables inspection logic to resolve it here.
        if len(path) > 1:
            is_found, new_table = _resolve_value_from_path(new_variable, path[1:])
            if not is_found:
                raise KeyError(f"Path {', '.join(path)} not found in value")
        else:
            new_table = new_variable

        if not _value_type_is_supported(new_table):
            # If a variable has been assigned a type that is not
            # supported in the existing data explorer tab, we should
            # tear down everything here and let the comm_closed event
            # signal the UI to make the explorer that the user may be
            # looking at invalid.
            return self._close_explorer(comm_id)

        def _fire_data_update():
            comm.send_event(DataExplorerFrontendEvent.DataUpdate.value, {})

        def _fire_schema_update(discard_state=False):
            msg = SchemaUpdateParams(discard_state=discard_state)
            comm.send_event(DataExplorerFrontendEvent.SchemaUpdate.value, msg.dict())

        if type(new_table) is not type(table_view.table):
            # Data type has changed. For now, we will signal the UI to
            # reset its entire state: sorting keys, filters, etc. and
            # start over. At some point we can return here and
            # selectively preserve state if we feel it is safe enough
            # to do so.
            self.table_views[comm_id] = _get_table_view(new_table)
            return _fire_schema_update(discard_state=True)

        # New value for data explorer is the same. For now, we just
        # invalidate the stored computatations and fire a data update,
        # but we'll come back here and improve this for immutable /
        # copy-on-write tables like Arrow and Polars
        #
        # TODO: address pathological pandas case where columns have
        # been modified
        if new_table is table_view.table:
            # The object references are the same, but we were probably
            # unsure about whether the data has been mutated, so we
            # invalidate the view's cached computations
            # (e.g. filter/sort indices) so they get recomputed
            table_view.invalidate_computations()
            return _fire_data_update()

        (
            should_update_schema,
            should_discard_state,
        ) = table_view.ui_should_update_schema(new_table)

        # The schema is the same, but the data has changed. We'll just
        # set a new table view and preserve the view state and be done
        # with it.
        self.table_views[comm_id] = _get_table_view(
            new_table,
            filters=table_view.filters,
            sort_keys=table_view.sort_keys,
        )

        if should_update_schema:
            _fire_schema_update(discard_state=should_discard_state)
        else:
            _fire_data_update()

    def handle_msg(self, msg: CommMessage[DataExplorerBackendMessageContent], raw_msg):
        """
        Handle messages received from the client via the
        positron.data_explorer comm.
        """
        comm_id = msg.content.comm_id
        request = msg.content.data

        comm = self.comms[comm_id]
        table = self.table_views[comm_id]

        result = getattr(table, request.method.value)(request)
        comm.send_result(result)

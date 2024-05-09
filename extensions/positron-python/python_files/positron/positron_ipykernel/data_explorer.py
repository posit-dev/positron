#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
#

# flake8: ignore E203
# pyright: reportOptionalMemberAccess=false

import abc
import logging
import operator
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
    BackendState,
    ColumnDisplayType,
    ColumnFrequencyTable,
    ColumnHistogram,
    ColumnProfileResult,
    ColumnProfileType,
    ColumnSchema,
    ColumnSortKey,
    ColumnSummaryStats,
    CompareFilterParamsOp,
    DataExplorerBackendMessageContent,
    DataExplorerFrontendEvent,
    FilterResult,
    GetColumnProfilesFeatures,
    GetColumnProfilesRequest,
    GetDataValuesRequest,
    GetSchemaRequest,
    GetStateRequest,
    RowFilter,
    RowFilterCondition,
    RowFilterType,
    SearchFilterType,
    SearchSchemaFeatures,
    SearchSchemaRequest,
    SearchSchemaResult,
    SetRowFiltersFeatures,
    SetRowFiltersRequest,
    SetSortColumnsRequest,
    SummaryStatsBoolean,
    SummaryStatsNumber,
    SummaryStatsString,
    SupportedFeatures,
    TableData,
    TableSchema,
    TableShape,
)
from .positron_comm import CommMessage, PositronComm
from .third_party import pd_
from .utils import guid

if TYPE_CHECKING:
    import pandas as pd

    # import polars as pl
    # import pyarrow as pa


logger = logging.getLogger(__name__)


PathKey = Tuple[str, ...]
StateUpdate = Tuple[bool, List[RowFilter], List[ColumnSortKey]]


class DataExplorerTableView(abc.ABC):
    """
    Interface providing a consistent wrapper around different data
    frame / table types for the data explorer for serving requests from
    the front end. This includes pandas.DataFrame, polars.DataFrame,
    pyarrow.Table, and any others
    """

    def __init__(
        self,
        display_name: str,
        table,
        filters: Optional[List[RowFilter]],
        sort_keys: Optional[List[ColumnSortKey]],
    ):
        self.display_name = display_name

        # Note: we must not ever modify the user's data
        self.table = table

        self.filters = filters if filters is not None else []
        self.sort_keys = sort_keys if sort_keys is not None else []

        self._need_recompute = len(self.filters) > 0 or len(self.sort_keys) > 0

    @abc.abstractmethod
    def _recompute(self):
        raise NotImplementedError

    def _recompute_if_needed(self) -> bool:
        if self._need_recompute:
            self._recompute()
            self._need_recompute = False
            return True
        else:
            return False

    def get_schema(self, request: GetSchemaRequest):
        return self._get_schema(request.params.start_index, request.params.num_columns).dict()

    def search_schema(self, request: SearchSchemaRequest):
        return self._search_schema(
            request.params.search_term,
            request.params.start_index,
            request.params.max_results,
        ).dict()

    def get_data_values(self, request: GetDataValuesRequest):
        self._recompute_if_needed()
        return self._get_data_values(
            request.params.row_start_index,
            request.params.num_rows,
            request.params.column_indices,
        ).dict()

    def set_row_filters(self, request: SetRowFiltersRequest):
        return self._set_row_filters(request.params.filters).dict()

    def set_sort_columns(self, request: SetSortColumnsRequest):
        return self._set_sort_columns(request.params.sort_keys)

    def get_column_profiles(self, request: GetColumnProfilesRequest):
        self._recompute_if_needed()
        results = []

        for req in request.params.profiles:
            if req.profile_type == ColumnProfileType.NullCount:
                count = self._prof_null_count(req.column_index)
                result = ColumnProfileResult(null_count=count)
            elif req.profile_type == ColumnProfileType.SummaryStats:
                stats = self._prof_summary_stats(req.column_index)
                result = ColumnProfileResult(summary_stats=stats)
            elif req.profile_type == ColumnProfileType.FrequencyTable:
                freq_table = self._prof_freq_table(req.column_index)
                result = ColumnProfileResult(frequency_table=freq_table)
            elif req.profile_type == ColumnProfileType.Histogram:
                histogram = self._prof_histogram(req.column_index)
                result = ColumnProfileResult(histogram=histogram)
            else:
                raise NotImplementedError(req.profile_type)
            results.append(result.dict())

        return results

    def get_state(self, _: GetStateRequest):
        self._recompute_if_needed()
        return self._get_state().dict()

    @abc.abstractmethod
    def invalidate_computations(self):
        pass

    @abc.abstractmethod
    def get_updated_state(self, new_table) -> StateUpdate:
        pass

    @abc.abstractmethod
    def _get_schema(self, column_start: int, num_columns: int) -> TableSchema:
        pass

    @abc.abstractmethod
    def _search_schema(
        self, search_term: str, start_index: int, max_results: int
    ) -> SearchSchemaResult:
        pass

    @abc.abstractmethod
    def _get_data_values(
        self,
        row_start: int,
        num_rows: int,
        column_indices: Sequence[int],
    ) -> TableData:
        pass

    @abc.abstractmethod
    def _set_row_filters(self, filters: List[RowFilter]) -> FilterResult:
        pass

    @abc.abstractmethod
    def _set_sort_columns(self, sort_keys: List[ColumnSortKey]):
        pass

    @abc.abstractmethod
    def _sort_data(self):
        pass

    @abc.abstractmethod
    def _prof_null_count(self, column_index: int) -> int:
        pass

    @abc.abstractmethod
    def _prof_summary_stats(self, column_index: int) -> ColumnSummaryStats:
        pass

    @abc.abstractmethod
    def _prof_freq_table(self, column_index: int) -> ColumnFrequencyTable:
        pass

    @abc.abstractmethod
    def _prof_histogram(self, column_index: int) -> ColumnHistogram:
        pass

    @abc.abstractmethod
    def _get_state(self) -> BackendState:
        pass


def _pandas_format_values(col):
    import pandas.io.formats.format as fmt

    try:
        return fmt.format_array(col._values, None, leading_space=False)
    except Exception:
        logger.warning(f"Failed to format column '{col.name}'")
        return col.astype(str).tolist()


_FILTER_RANGE_COMPARE_SUPPORTED = {
    ColumnDisplayType.Number,
    ColumnDisplayType.Date,
    ColumnDisplayType.Datetime,
    ColumnDisplayType.Time,
}


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
        "bool": "boolean",
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
        display_name: str,
        table,
        filters: Optional[List[RowFilter]],
        sort_keys: Optional[List[ColumnSortKey]],
    ):
        super().__init__(display_name, table, filters, sort_keys)

        # Maintain a mapping of column index to inferred dtype for any
        # object columns, to avoid recomputing. If the underlying
        # object is changed, this needs to be reset
        self._inferred_dtypes = {}

        # We store the column schemas for each sort key to help with
        # eviction later during updates
        self._sort_key_schemas: List[ColumnSchema] = []

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

        # We store a tuple of (last_search_term, matches)
        # here so that we can support scrolling through the search
        # results without having to recompute the search. If the
        # search term changes, we discard the last search result. We
        # might add an LRU cache here or something if it helps
        # performance.
        self._search_schema_last_result: Optional[Tuple[str, List[ColumnSchema]]] = None

        # Putting this here rather than in the class body before
        # Python < 3.10 has fussier rules about staticmethods
        self._SUMMARIZERS = {
            ColumnDisplayType.Boolean: self._summarize_boolean,
            ColumnDisplayType.Number: self._summarize_number,
            ColumnDisplayType.String: self._summarize_string,
        }

    def invalidate_computations(self):
        self.filtered_indices = self.view_indices = None
        self._need_recompute = True

    def get_updated_state(self, new_table) -> StateUpdate:
        from pandas.api.types import infer_dtype

        filtered_columns = {
            filt.column_schema.column_index: filt.column_schema for filt in self.filters
        }

        # self.table may have been modified in place, so we cannot
        # assume that new_table is different than self.table
        if new_table is self.table:
            # For in-place updates, we have to assume the worst case
            # scenario of a schema change
            schema_updated = True
        else:
            # The table object has changed -- now we look for
            # suspected schema changes
            schema_updated = False

        # We go through the columns in the new table and see whether
        # there is a type change or whether a column name moved.
        #
        # TODO: duplicate column names are a can of worms here, and we
        # will need to return to make this logic robust to that
        old_columns = self.table.columns
        shifted_columns: Dict[int, int] = {}
        schema_changes: Dict[int, ColumnSchema] = {}

        # First, we look for detectable deleted columns
        deleted_columns: Set[int] = set()
        if not self.table.columns.equals(new_table.columns):
            for old_index, column in enumerate(self.table.columns):
                if column not in new_table.columns:
                    deleted_columns.add(old_index)
                    schema_updated = True

        def _get_column_schema(column, column_name, column_index):
            # We only use infer_dtype for columns that are involved in
            # a filter
            type_name, type_display = self._get_type_display(
                column.dtype, lambda: infer_dtype(column)
            )

            return ColumnSchema(
                column_name=column_name,
                column_index=column_index,
                type_name=type_name,
                type_display=type_display,
            )

        # When computing the new display type of a column requires
        # calling infer_dtype, we are careful to only do it for
        # columns that are involved in a filter
        for new_index, column_name in enumerate(new_table.columns):
            # New table has more columns than the old table
            out_of_bounds = new_index >= len(old_columns)

            if out_of_bounds or old_columns[new_index] != column_name:
                if column_name not in old_columns:
                    # New column
                    schema_updated = True
                    continue
                # Column was shifted
                old_index = old_columns.get_loc(column_name)
                shifted_columns[old_index] = new_index
            else:
                old_index = new_index

            new_column = new_table.iloc[:, new_index]

            # For object dtype columns, we refuse to make any
            # assumptions about whether the data type has changed
            # and will let re-filtering fail later if there is a
            # problem
            if new_column.dtype == object:
                # The inferred type could be different
                schema_updated = True
            elif new_table is not self.table:
                # While we must proceed under the conservative
                # possibility that the table was modified in place, if
                # the tables are indeed different we can check for
                # schema changes more confidently
                old_dtype = self.table.iloc[:, old_index].dtype
                if new_column.dtype == old_dtype:
                    # Type is the same and not object dtype
                    continue
            elif old_index in filtered_columns:
                # If it was an in place modification, as a last ditch
                # effort we check if we remember the data type because
                # of a prior filter
                if filtered_columns[old_index].type_name == str(new_column.dtype):
                    # Type is the same and not object dtype
                    continue

            # The type maybe changed
            schema_updated = True

            if old_index not in filtered_columns:
                # This column index did not have a row filter
                # attached to it, so doing further analysis is
                # unnecessary
                continue

            schema_changes[old_index] = _get_column_schema(new_column, str(column_name), new_index)

        new_filters = []
        for filt in self.filters:
            column_index = filt.column_schema.column_index
            column_name = filt.column_schema.column_name

            filt = filt.copy(deep=True)

            is_deleted = False
            if column_index in schema_changes:
                # A schema change is only valid if the column name is
                # the same, otherwise it's a deletion
                change = schema_changes[column_index]
                if column_name == change.column_name:
                    filt.column_schema = change.copy()
                else:
                    # Column may be deleted. We need to distinguish
                    # between the case of a deleted column that was
                    # filtered and a filter that was invalid and is
                    # now valid again as a result of changes in the
                    # data (e.g. deleting a column and then re-adding
                    # it right away)
                    if str(new_table.columns[column_index]) == column_name:
                        # Probably a new column that allows the old
                        # filter to become valid again if the type is
                        # compatible
                        filt.column_schema = _get_column_schema(
                            new_table.iloc[:, column_index],
                            column_name,
                            column_index,
                        )
                    else:
                        is_deleted = True
            elif column_index in shifted_columns:
                filt.column_schema.column_index = shifted_columns[column_index]
            elif column_index in deleted_columns:
                # Column deleted
                is_deleted = True

            # If the column was not deleted, we always reset the
            # validity state of the filter in case something we
            # did to the data made a previous filter error (which
            # set the is_valid flag to False) to go away.
            if is_deleted:
                filt.is_valid = False
                filt.error_message = "Column was deleted"
            else:
                filt.is_valid = self._is_supported_filter(filt)
                if filt.is_valid:
                    filt.error_message = None
                else:
                    filt.error_message = "Unsupported column type for filter"

            new_filters.append(filt)

        new_sort_keys = []
        for i, key in enumerate(self.sort_keys):
            column_index = key.column_index
            prior_name = self._sort_key_schemas[i].column_name

            key = key.copy()

            # Evict any sort key that was deleted
            if column_index in schema_changes:
                # A schema change is only valid if the column name is
                # the same, otherwise it's a deletion
                change = schema_changes[column_index]
                if prior_name == change.column_name:
                    key.column_schema = change.copy()
                else:
                    # Column deleted
                    continue
            elif column_index in shifted_columns:
                key.column_index = shifted_columns[column_index]
            elif column_index in deleted_columns or prior_name != str(
                new_table.columns[column_index]
            ):
                # Column deleted
                continue

            new_sort_keys.append(key)

        return schema_updated, new_filters, new_sort_keys

    def _recompute(self):
        # Re-setting the column filters will trigger filtering AND
        # sorting
        self._set_row_filters(self.filters)

    def _get_schema(self, column_start: int, num_columns: int) -> TableSchema:
        column_schemas = []

        for column_index in range(
            column_start,
            min(column_start + num_columns, len(self.table.columns)),
        ):
            col_schema = self._get_single_column_schema(column_index)
            column_schemas.append(col_schema)

        return TableSchema(columns=column_schemas)

    def _search_schema(
        self, search_term: str, start_index: int, max_results: int
    ) -> SearchSchemaResult:
        # Sanitize user input here for now, possibly remove this later
        search_term = search_term.lower()

        if self._search_schema_last_result is not None:
            last_search_term, matches = self._search_schema_last_result
            if last_search_term != search_term:
                matches = self._search_schema_get_matches(search_term)
                self._search_schema_last_result = (search_term, matches)
        else:
            matches = self._search_schema_get_matches(search_term)
            self._search_schema_last_result = (search_term, matches)

        matches_slice = matches[start_index : start_index + max_results]
        return SearchSchemaResult(
            matches=TableSchema(columns=matches_slice),
            total_num_matches=len(matches),
        )

    def _search_schema_get_matches(self, search_term: str) -> List[ColumnSchema]:
        matches = []
        for column_index in range(len(self.table.columns)):
            column_raw_name = self.table.columns[column_index]
            column_name = str(column_raw_name)

            # Do a case-insensitive search
            if search_term not in column_name.lower():
                continue

            col_schema = self._get_single_column_schema(column_index)
            matches.append(col_schema)

        return matches

    def _get_inferred_dtype(self, column_index: int):
        from pandas.api.types import infer_dtype

        if column_index not in self._inferred_dtypes:
            self._inferred_dtypes[column_index] = infer_dtype(self.table.iloc[:, column_index])
        return self._inferred_dtypes[column_index]

    @classmethod
    def _get_type_display(cls, dtype, get_inferred_dtype):
        # A helper function for returning the backend type_name and
        # the display type when returning schema results or analyzing
        # schema changes

        # TODO: pandas MultiIndex columns
        # TODO: time zone for datetimetz datetime64[ns] types
        if dtype == object:
            type_name = get_inferred_dtype()
        else:
            # TODO: more sophisticated type mapping
            type_name = str(dtype)

        type_display = cls.TYPE_DISPLAY_MAPPING.get(type_name, "unknown")

        return type_name, ColumnDisplayType(type_display)

    def _get_single_column_schema(self, column_index: int):
        column_raw_name = self.table.columns[column_index]
        column_name = str(column_raw_name)

        type_name, type_display = self._get_type_display(
            self.table.iloc[:, column_index].dtype,
            lambda: self._get_inferred_dtype(column_index),
        )

        return ColumnSchema(
            column_name=column_name,
            column_index=column_index,
            type_name=type_name,
            type_display=type_display,
        )

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
            # the view_indices to select the virtual range of values
            # for the grid
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

    def _set_sort_columns(self, sort_keys: List[ColumnSortKey]):
        self.sort_keys = sort_keys

        self._sort_key_schemas = [
            self._get_single_column_schema(key.column_index) for key in sort_keys
        ]

        if not self._recompute_if_needed():
            # If a re-filter is pending, then it will automatically
            # trigger a sort
            self._sort_data()

    def _set_row_filters(self, filters: List[RowFilter]) -> FilterResult:
        self.filters = filters

        for filt in self.filters:
            # If is_valid isn't set, set it based on what is currently
            # supported
            if filt.is_valid is None:
                filt.is_valid = self._is_supported_filter(filt)

        if len(filters) == 0:
            # Simply reset if empty filter set passed
            self.filtered_indices = None
            self._update_view_indices()
            return FilterResult(selected_num_rows=len(self.table), had_errors=False)

        # Evaluate all the filters and combine them using the
        # indicated conditions
        combined_mask = None
        had_errors = False
        for filt in filters:
            if filt.is_valid is False:
                # If filter is invalid, do not evaluate it
                continue

            try:
                single_mask = self._eval_filter(filt)
            except Exception as e:
                had_errors = True

                # Filter fails: we capture the error message and mark
                # the filter as invalid
                filt.is_valid = False
                filt.error_message = str(e)

                # Perhaps use a different log level, but to help with
                # debugging for now.
                logger.warning(e, exc_info=True)
                continue

            if combined_mask is None:
                combined_mask = single_mask
            elif filt.condition == RowFilterCondition.And:
                combined_mask &= single_mask
            elif filt.condition == RowFilterCondition.Or:
                combined_mask |= single_mask

        if combined_mask is None:
            self.filtered_indices = None
            selected_num_rows = len(self.table)
        else:
            self.filtered_indices = combined_mask.nonzero()[0]
            selected_num_rows = len(self.filtered_indices)

        # Update the view indices, re-sorting if needed
        self._update_view_indices()
        return FilterResult(selected_num_rows=selected_num_rows, had_errors=had_errors)

    def _is_supported_filter(self, filt: RowFilter) -> bool:
        if filt.filter_type not in self.SUPPORTED_FILTERS:
            return False

        display_type = filt.column_schema.type_display

        if filt.filter_type in [
            RowFilterType.IsEmpty,
            RowFilterType.NotEmpty,
            RowFilterType.Search,
        ]:
            # String-only filter types
            return display_type == ColumnDisplayType.String
        elif filt.filter_type == RowFilterType.Compare:
            compare_op = filt.compare_params.op
            if compare_op in [
                CompareFilterParamsOp.Eq,
                CompareFilterParamsOp.NotEq,
            ]:
                return True
            else:
                return display_type in _FILTER_RANGE_COMPARE_SUPPORTED
        elif filt.filter_type in [
            RowFilterType.Between,
            RowFilterType.NotBetween,
        ]:
            return display_type in _FILTER_RANGE_COMPARE_SUPPORTED
        elif filt.filter_type in [
            RowFilterType.IsTrue,
            RowFilterType.IsFalse,
        ]:
            return display_type == ColumnDisplayType.Boolean
        else:
            # Filters always supported
            assert filt.filter_type in [
                RowFilterType.IsNull,
                RowFilterType.NotNull,
                RowFilterType.SetMembership,
            ]
            return True

    def _eval_filter(self, filt: RowFilter):
        column_index = filt.column_schema.column_index

        col = self.table.iloc[:, column_index]
        mask = None
        if filt.filter_type in (
            RowFilterType.Between,
            RowFilterType.NotBetween,
        ):
            params = filt.between_params
            assert params is not None
            left_value = _coerce_value_param(params.left_value, col.dtype)
            right_value = _coerce_value_param(params.right_value, col.dtype)
            if filt.filter_type == RowFilterType.Between:
                mask = (col >= left_value) & (col <= right_value)
            else:
                # NotBetween
                mask = (col < left_value) | (col > right_value)
        elif filt.filter_type == RowFilterType.Compare:
            params = filt.compare_params
            assert params is not None

            if params.op not in COMPARE_OPS:
                raise ValueError(f"Unsupported filter type: {params.op}")
            op = COMPARE_OPS[params.op]
            # pandas comparison filters return False for null values
            mask = op(col, _coerce_value_param(params.value, col.dtype))
        elif filt.filter_type == RowFilterType.IsEmpty:
            mask = col.str.len() == 0
        elif filt.filter_type == RowFilterType.IsNull:
            mask = col.isnull()
        elif filt.filter_type == RowFilterType.NotEmpty:
            mask = col.str.len() != 0
        elif filt.filter_type == RowFilterType.NotNull:
            mask = col.notnull()
        elif filt.filter_type == RowFilterType.IsTrue:
            mask = col == True  # noqa: E712
        elif filt.filter_type == RowFilterType.IsFalse:
            mask = col == False  # noqa: E712
        elif filt.filter_type == RowFilterType.SetMembership:
            params = filt.set_membership_params
            assert params is not None
            boxed_values = pd_.Series(params.values).astype(col.dtype)
            # IN
            mask = col.isin(boxed_values)
            if not params.inclusive:
                # NOT-IN
                mask = ~mask
        elif filt.filter_type == RowFilterType.Search:
            params = filt.search_params
            assert params is not None

            col_inferred_type = self._get_inferred_dtype(column_index)

            if col_inferred_type != "string":
                col = col.astype(str)

            term = params.term

            if params.search_type == SearchFilterType.RegexMatch:
                mask = col.str.match(term, case=params.case_sensitive)
            else:
                if not params.case_sensitive:
                    col = col.str.lower()
                    term = term.lower()
                if params.search_type == SearchFilterType.Contains:
                    mask = col.str.contains(term)
                elif params.search_type == SearchFilterType.StartsWith:
                    mask = col.str.startswith(term)
                elif params.search_type == SearchFilterType.EndsWith:
                    mask = col.str.endswith(term)

        assert mask is not None

        # Nulls are possible in the mask, so we just fill them if any
        if mask.dtype != bool:
            mask[mask.isna()] = False
            mask = mask.astype(bool)

        return mask.to_numpy()

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
                col = self._get_column(key.column_index)
                cols_to_sort.append(col)
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

    def _get_column(self, column_index: int) -> "pd.Series":
        column = self.table.iloc[:, column_index]
        if self.filtered_indices is not None:
            column = column.take(self.filtered_indices)
        return column

    def _prof_null_count(self, column_index: int):
        return self._get_column(column_index).isnull().sum()

    def _prof_summary_stats(self, column_index: int):
        col_schema = self._get_single_column_schema(column_index)
        col = self._get_column(column_index)

        ui_type = col_schema.type_display
        handler = self._SUMMARIZERS.get(ui_type)

        if handler is None:
            # Return nothing for types we don't yet know how to summarize
            return ColumnSummaryStats(type_display=ui_type)
        else:
            return handler(col)

    @staticmethod
    def _summarize_number(col: "pd.Series"):
        import pandas.io.formats.format as fmt

        minmax = pd_.Series([col.min(), col.max()], dtype=col.dtype)
        numeric_stats = pd_.Series([col.mean(), col.median(), col.std()])

        min_value, max_value = fmt.format_array(minmax.to_numpy(), None, leading_space=False)
        mean, median, stdev = fmt.format_array(numeric_stats.to_numpy(), None, leading_space=False)

        return ColumnSummaryStats(
            type_display=ColumnDisplayType.Number,
            number_stats=SummaryStatsNumber(
                min_value=min_value,
                max_value=max_value,
                mean=mean,
                median=median,
                stdev=stdev,
            ),
        )

    @staticmethod
    def _summarize_string(col: "pd.Series"):
        num_empty = (col.str.len() == 0).sum()
        num_unique = col.nunique()

        return ColumnSummaryStats(
            type_display=ColumnDisplayType.String,
            string_stats=SummaryStatsString(num_empty=num_empty, num_unique=num_unique),
        )

    @staticmethod
    def _summarize_boolean(col: "pd.Series"):
        null_count = col.isnull().sum()
        true_count = col.sum()
        false_count = len(col) - true_count - null_count

        return ColumnSummaryStats(
            type_display=ColumnDisplayType.Boolean,
            boolean_stats=SummaryStatsBoolean(true_count=true_count, false_count=false_count),
        )

    def _prof_freq_table(self, column_index: int):
        raise NotImplementedError

    def _prof_histogram(self, column_index: int):
        raise NotImplementedError

    SUPPORTED_FILTERS = {
        RowFilterType.Between,
        RowFilterType.Compare,
        RowFilterType.IsEmpty,
        RowFilterType.IsFalse,
        RowFilterType.IsNull,
        RowFilterType.IsTrue,
        RowFilterType.NotBetween,
        RowFilterType.NotEmpty,
        RowFilterType.NotNull,
        RowFilterType.Search,
        RowFilterType.SetMembership,
    }

    FEATURES = SupportedFeatures(
        search_schema=SearchSchemaFeatures(supported=True),
        set_row_filters=SetRowFiltersFeatures(
            supported=True,
            supports_conditions=True,
            supported_types=list(SUPPORTED_FILTERS),
        ),
        get_column_profiles=GetColumnProfilesFeatures(
            supported=True,
            supported_types=[
                ColumnProfileType.NullCount,
                ColumnProfileType.SummaryStats,
            ],
        ),
    )

    def _get_state(self) -> BackendState:
        table_unfiltered_shape = TableShape(
            num_rows=self.table.shape[0], num_columns=self.table.shape[1]
        )

        if self.view_indices is not None:
            # Account for filters
            table_shape = TableShape(
                num_rows=len(self.view_indices),
                num_columns=self.table.shape[1],
            )
        else:
            table_shape = table_unfiltered_shape

        return BackendState(
            display_name=self.display_name,
            table_shape=table_shape,
            table_unfiltered_shape=table_unfiltered_shape,
            row_filters=self.filters,
            sort_keys=self.sort_keys,
            supported_features=self.FEATURES,
        )


COMPARE_OPS = {
    CompareFilterParamsOp.Gt: operator.gt,
    CompareFilterParamsOp.GtEq: operator.ge,
    CompareFilterParamsOp.Lt: operator.lt,
    CompareFilterParamsOp.LtEq: operator.le,
    CompareFilterParamsOp.Eq: operator.eq,
    CompareFilterParamsOp.NotEq: operator.ne,
}


def _coerce_value_param(value, dtype):
    # Let pandas decide how to coerce the string we got from the UI
    dummy = pd_.Series([value]).astype(dtype)
    return dummy.iloc[0]


class PolarsView(DataExplorerTableView):
    pass


class PyArrowView(DataExplorerTableView):
    pass


def _get_table_view(table, filters=None, sort_keys=None, name=None):
    name = name or guid()
    return PandasView(name, table, filters, sort_keys)


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
            comm_id = guid()

        if variable_path is not None:
            full_title = ", ".join([str(decode_access_key(k)) for k in variable_path])
        else:
            full_title = title

        self.table_views[comm_id] = _get_table_view(table, name=full_title)

        base_comm = comm.create_comm(
            target_name=self.comm_target,
            comm_id=comm_id,
            data={"title": title},
        )

        def close_callback(_):
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

        full_title = ", ".join([str(decode_access_key(k)) for k in path])

        # When detecting namespace assignments or changes, the first
        # level of the path has already been resolved. If there is a
        # data explorer open for a nested value, then we need to use
        # the same variables inspection logic to resolve it here.
        if len(path) > 1:
            is_found, new_table = _resolve_value_from_path(new_variable, path[1:])
            if not is_found:
                raise KeyError(f"Path {full_title} not found in value")
        else:
            new_table = new_variable

        if not _value_type_is_supported(new_table):
            # If a variable has been assigned a type that is not
            # supported in the existing data explorer tab, we should
            # tear down everything here and let the comm_closed event
            # signal the UI to make the explorer that the user may be
            # looking at invalid.
            return self._close_explorer(comm_id)

        if not isinstance(new_table, type(table_view.table)):
            # Data structure type has changed. For now, we drop the
            # entire state: sorting keys, filters, etc. and start
            # over. At some point we can return here and selectively
            # preserve state if we can confidently do so.
            schema_updated = True
            new_filters = []
            new_sort_keys = []
        else:
            (schema_updated, new_filters, new_sort_keys) = table_view.get_updated_state(new_table)

        self.table_views[comm_id] = _get_table_view(
            new_table,
            filters=new_filters,
            sort_keys=new_sort_keys,
            name=full_title,
        )

        if schema_updated:
            comm.send_event(DataExplorerFrontendEvent.SchemaUpdate.value, {})
        else:
            comm.send_event(DataExplorerFrontendEvent.DataUpdate.value, {})

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

        # To help remember to convert pydantic types to dicts
        if result is not None:
            if isinstance(result, list):
                for x in result:
                    assert isinstance(x, dict)
            else:
                assert isinstance(result, dict)

        comm.send_result(result)

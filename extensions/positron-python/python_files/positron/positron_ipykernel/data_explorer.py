#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

# flake8: ignore E203
# pyright: reportOptionalMemberAccess=false

import abc
import logging
import math
import operator
from datetime import datetime
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
    ColumnFilter,
    ColumnFilterType,
    ColumnFilterTypeSupportStatus,
    ColumnFrequencyTable,
    ColumnHistogram,
    ColumnProfileResult,
    ColumnProfileType,
    ColumnProfileTypeSupportStatus,
    ColumnSchema,
    ColumnSortKey,
    ColumnSummaryStats,
    ColumnValue,
    DataExplorerBackendMessageContent,
    DataExplorerFrontendEvent,
    DataSelectionCellRange,
    DataSelectionIndices,
    DataSelectionKind,
    DataSelectionRange,
    DataSelectionSingleCell,
    ExportDataSelectionFeatures,
    ExportDataSelectionRequest,
    ExportedData,
    ExportFormat,
    FilterBetween,
    FilterComparison,
    FilterComparisonOp,
    FilterMatchDataTypes,
    FilterResult,
    FilterSetMembership,
    FilterTextSearch,
    FormatOptions,
    GetColumnProfilesFeatures,
    GetColumnProfilesRequest,
    GetDataValuesRequest,
    GetSchemaRequest,
    GetStateRequest,
    RowFilter,
    RowFilterCondition,
    RowFilterType,
    RowFilterTypeSupportStatus,
    SearchSchemaFeatures,
    SearchSchemaRequest,
    SearchSchemaResult,
    SetRowFiltersFeatures,
    SetRowFiltersRequest,
    SetSortColumnsFeatures,
    SetSortColumnsRequest,
    SummaryStatsBoolean,
    SummaryStatsDate,
    SummaryStatsDatetime,
    SummaryStatsNumber,
    SummaryStatsString,
    SupportedFeatures,
    SupportStatus,
    TableSchema,
    TableShape,
    TextSearchType,
)
from .positron_comm import CommMessage, PositronComm
from .third_party import np_, pd_, pl_
from .utils import guid

if TYPE_CHECKING:
    import pandas as pd
    import polars as pl

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
        self._set_sort_keys(sort_keys)

        self._need_recompute = len(self.filters) > 0 or len(self.sort_keys) > 0

        # Array of selected ("true") indices using filters. If
        # there are also sort keys, we first filter the unsorted data,
        # and then sort the filtered data only, for the optimistic
        # case that a low-selectivity filters yields less data to sort
        self.filtered_indices = None

        # Array of selected AND reordered indices
        # (e.g. including any sorting). If there are no sort keys and
        # only filters, then this should be the same as
        # self.filtered_indices
        self.view_indices = None

        # We store a tuple of (last_filters, matches) here so that we
        # can support scrolling through the schema search results
        # without having to recompute the search. If the search term
        # changes, we discard the last search result. We might add an
        # LRU cache here or something if it helps performance.
        self._search_schema_last_result: Optional[Tuple[List[ColumnFilter], List[ColumnSchema]]] = (
            None
        )

    def _set_sort_keys(self, sort_keys):
        self.sort_keys = sort_keys if sort_keys is not None else []

        # We store the column schemas for each sort key to help with
        # eviction later during updates
        self._sort_key_schemas = [
            self._get_single_column_schema(key.column_index) for key in self.sort_keys
        ]

    def _recompute_if_needed(self) -> bool:
        if self._need_recompute:
            self._recompute()
            self._need_recompute = False
            return True
        else:
            return False

    def _update_view_indices(self):
        if len(self.sort_keys) == 0:
            self.view_indices = self.filtered_indices
        else:
            # If we have just applied a new filter, we now resort to
            # reflect the filtered_indices that have just been updated
            self._sort_data()

    def get_schema(self, request: GetSchemaRequest):
        column_schemas = []

        start = request.params.start_index
        num_columns = request.params.num_columns

        for column_index in range(
            start,
            min(start + num_columns, self.table.shape[1]),
        ):
            col_schema = self._get_single_column_schema(column_index)
            column_schemas.append(col_schema)

        return TableSchema(columns=column_schemas).dict()

    def _get_single_column_schema(self, column_index: int) -> ColumnSchema:
        raise NotImplementedError

    def search_schema(self, request: SearchSchemaRequest):
        filters = request.params.filters
        start_index = request.params.start_index
        max_results = request.params.max_results
        if self._search_schema_last_result is not None:
            last_filters, matches = self._search_schema_last_result
            if last_filters != filters:
                matches = self._search_schema_get_matches(filters)
                self._search_schema_last_result = (filters, matches)
        else:
            matches = self._search_schema_get_matches(filters)
            self._search_schema_last_result = (filters, matches)

        matches_slice = matches[start_index : start_index + max_results]
        return SearchSchemaResult(
            matches=TableSchema(columns=matches_slice),
            total_num_matches=len(matches),
        ).dict()

    def _search_schema_get_matches(self, filters: List[ColumnFilter]) -> List[ColumnSchema]:
        matchers = self._get_column_filter_functions(filters)

        parent = self

        class SchemaMemo:
            def __init__(self):
                self.memo = {}

            def get(self, i):
                if i in self.memo:
                    return self.memo[i]
                else:
                    schema = parent._get_single_column_schema(i)
                    self.memo[i] = schema
                    return schema

        schema_memo = SchemaMemo()
        matches = [
            self._get_single_column_schema(column_index)
            for column_index in range(self.table.shape[1])
            if all(matcher(column_index, schema_memo) for matcher in matchers)
        ]

        return matches

    def _get_column_filter_functions(self, filters: List[ColumnFilter]):
        def _match_text_search(params: FilterTextSearch):
            term = params.term
            if not params.case_sensitive:
                term = term.lower()

                def matches(x):
                    return term in x.lower()
            else:

                def matches(x):
                    return term in x

            def matcher(index, _):
                return matches(self._get_column_name(index))

            return matcher

        def _match_display_types(params: FilterMatchDataTypes):
            def matcher(index, schema_memo):
                schema: ColumnSchema = schema_memo.get(index)
                return schema.type_display in params.display_types

            return matcher

        matchers = []
        for filt in filters:
            if filt.filter_type == ColumnFilterType.TextSearch:
                params = filt.params
                assert isinstance(params, FilterTextSearch)
                matchers.append(_match_text_search(params))
            elif filt.filter_type == ColumnFilterType.MatchDataTypes:
                params = filt.params
                assert isinstance(params, FilterMatchDataTypes)
                matchers.append(_match_display_types(params))

        return matchers

    def _get_column_name(self, column_index: int) -> str:
        raise NotImplementedError

    def get_data_values(self, request: GetDataValuesRequest):
        self._recompute_if_needed()
        return self._get_data_values(
            request.params.row_start_index,
            request.params.num_rows,
            request.params.column_indices,
            request.params.format_options,
        )

    def export_data_selection(self, request: ExportDataSelectionRequest):
        self._recompute_if_needed()
        kind = request.params.selection.kind
        sel = request.params.selection.selection
        fmt = request.params.format
        if kind == DataSelectionKind.SingleCell:
            assert isinstance(sel, DataSelectionSingleCell)
            row_index = sel.row_index
            if self.view_indices is not None:
                row_index = self.view_indices[row_index]
            return self._export_cell(row_index, sel.column_index, fmt)
        elif kind == DataSelectionKind.CellRange:
            assert isinstance(sel, DataSelectionCellRange)
            return self._export_tabular(
                slice(sel.first_row_index, sel.last_row_index + 1),
                slice(sel.first_column_index, sel.last_column_index + 1),
                fmt,
            )
        elif kind == DataSelectionKind.RowRange:
            assert isinstance(sel, DataSelectionRange)
            return self._export_tabular(
                slice(sel.first_index, sel.last_index + 1),
                slice(None),
                fmt,
            )
        elif kind == DataSelectionKind.ColumnRange:
            assert isinstance(sel, DataSelectionRange)
            return self._export_tabular(
                slice(None),
                slice(sel.first_index, sel.last_index + 1),
                fmt,
            )
        elif kind == DataSelectionKind.RowIndices:
            assert isinstance(sel, DataSelectionIndices)
            return self._export_tabular(sel.indices, slice(None), fmt)
        elif kind == DataSelectionKind.ColumnIndices:
            assert isinstance(sel, DataSelectionIndices)
            return self._export_tabular(slice(None), sel.indices, fmt)
        else:
            raise NotImplementedError(f"Unknown data export: {kind}")

    def _export_cell(self, row_index: int, column_index: int, fmt: ExportFormat):
        raise NotImplementedError

    def _export_tabular(self, row_selector, column_selector, fmt: ExportFormat):
        raise NotImplementedError

    def set_row_filters(self, request: SetRowFiltersRequest):
        return self._set_row_filters(request.params.filters).dict()

    def _set_row_filters(self, filters: List[RowFilter]) -> FilterResult:
        self.filters = filters
        for filt in filters:
            # If is_valid isn't set, set it based on what is currently
            # supported
            if filt.is_valid is None:
                filt.is_valid = self._is_supported_filter(filt)

        if len(self.filters) == 0:
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

        self.filtered_indices = self._mask_to_indices(combined_mask)
        selected_num_rows = (
            len(self.table) if self.filtered_indices is None else len(self.filtered_indices)
        )

        # Update the view indices, re-sorting if needed
        self._update_view_indices()
        return FilterResult(selected_num_rows=selected_num_rows, had_errors=had_errors)

    def _mask_to_indices(self, mask):
        raise NotImplementedError

    def _eval_filter(self, filt: RowFilter):
        raise NotImplementedError

    def set_sort_columns(self, request: SetSortColumnsRequest):
        self._set_sort_keys(request.params.sort_keys)

        if not self._recompute_if_needed():
            # If a re-filter is pending, then it will automatically
            # trigger a sort
            self._sort_data()

    def _sort_data(self):
        raise NotImplementedError

    def get_column_profiles(self, request: GetColumnProfilesRequest):
        self._recompute_if_needed()
        results = []

        for req in request.params.profiles:
            if req.profile_type == ColumnProfileType.NullCount:
                count = self._prof_null_count(req.column_index)
                result = ColumnProfileResult(null_count=int(count))
            elif req.profile_type == ColumnProfileType.SummaryStats:
                stats = self._prof_summary_stats(req.column_index, request.params.format_options)
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

    def _recompute(self):
        # Re-setting the column filters will trigger filtering AND
        # sorting
        self._set_row_filters(self.filters)

    def get_updated_state(self, new_table) -> StateUpdate:
        raise NotImplementedError

    def _get_adjusted_filters(
        self,
        new_columns,
        schema_changes,
        shifted_columns,
        deleted_columns,
        schema_getter,
    ):
        # Shared by implementations of get_updated_state
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
                    if str(new_columns[column_index]) == column_name:
                        # Probably a new column that allows the old
                        # filter to become valid again if the type is
                        # compatible
                        filt.column_schema = schema_getter(
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

        return new_filters

    def _get_adjusted_sort_keys(
        self, new_columns, schema_changes, shifted_columns, deleted_columns
    ):
        # Shared by implementations of get_updated_state
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
            elif column_index in deleted_columns or prior_name != str(new_columns[column_index]):
                # Column deleted
                continue

            new_sort_keys.append(key)

        return new_sort_keys

    def _get_data_values(
        self,
        row_start: int,
        num_rows: int,
        column_indices: Sequence[int],
        format_options: FormatOptions,
    ) -> dict:
        raise NotImplementedError

    SUPPORTED_FILTERS = set()

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
            params = filt.params
            assert isinstance(params, FilterComparison), str(params)
            if params.op in [
                FilterComparisonOp.Eq,
                FilterComparisonOp.NotEq,
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

    def _prof_null_count(self, column_index: int) -> int:
        raise NotImplementedError

    def _prof_summary_stats(self, column_index: int, options: FormatOptions) -> ColumnSummaryStats:
        raise NotImplementedError

    def _prof_freq_table(self, column_index: int) -> ColumnFrequencyTable:
        raise NotImplementedError

    def _prof_histogram(self, column_index: int) -> ColumnHistogram:
        raise NotImplementedError

    FEATURES = None

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


class UnsupportedView(DataExplorerTableView):
    def __init__(self, display_name, table):
        super().__init__(display_name, table, [], [])


# Special value codes for the protocol
_VALUE_NULL = 0
_VALUE_NA = 1
_VALUE_NAN = 2
_VALUE_NAT = 3
_VALUE_NONE = 4
_VALUE_INF = 10
_VALUE_NEGINF = 11


if np_ is not None:

    def _is_float_scalar(x):
        return isinstance(x, (float, np_.floating))

    _isnan = np_.isnan  # type: ignore
    _isinf = np_.isinf  # type: ignore
else:

    def _is_float_scalar(x):
        return isinstance(x, float)

    def _isnan(x: float) -> bool:
        return x != x

    def _isinf(x: float) -> bool:
        return math.isinf(x)


def _get_float_formatter(options: FormatOptions) -> Callable:
    sci_format = f".{options.large_num_digits}E"
    medium_format = f".{options.large_num_digits}f"
    small_format = f".{options.small_num_digits}f"

    # The limit for large numbers before switching to scientific
    # notation
    upper_threshold = float("1" + "0" * options.max_integral_digits)

    # The limit for small numbers before switching to scientific
    # notation
    lower_threshold = float("0." + "0" * (options.small_num_digits - 1) + "1")

    thousands_sep = options.thousands_sep

    if thousands_sep is not None:
        # We format with comma then replace later
        medium_format = "," + medium_format

    def base_float_format(x) -> str:
        abs_x = abs(x)

        if abs_x >= 1:
            if abs_x < upper_threshold:
                # Has non-zero integral part but below
                return format(x, medium_format)
            else:
                return format(x, sci_format)
        elif abs_x == 0:
            # Special case 0 to align with other "medium" numbers
            return format(x, medium_format)
        else:
            if abs_x >= lower_threshold:
                # Less than 1 but above lower threshold
                return format(x, small_format)
            else:
                return format(x, sci_format)

    if thousands_sep is not None:
        if thousands_sep != ",":

            def float_format(x) -> str:
                base = base_float_format(x)
                return base.replace(",", thousands_sep)

            return float_format
        else:
            return base_float_format
    else:
        return base_float_format


_FILTER_RANGE_COMPARE_SUPPORTED = {
    ColumnDisplayType.Number,
    ColumnDisplayType.Date,
    ColumnDisplayType.Datetime,
    ColumnDisplayType.Time,
}


def _pandas_datetimetz_mapper(type_name):
    if "datetime64" in type_name:
        return "datetime"


class PandasView(DataExplorerTableView):
    TYPE_NAME_MAPPING = {"boolean": "bool"}

    def __init__(
        self,
        display_name: str,
        table,
        filters: Optional[List[RowFilter]],
        sort_keys: Optional[List[ColumnSortKey]],
    ):
        table = self._maybe_wrap(table)

        super().__init__(display_name, table, filters, sort_keys)

        # Maintain a mapping of column index to inferred dtype for any
        # object columns, to avoid recomputing. If the underlying
        # object is changed, this needs to be reset
        self._inferred_dtypes = {}

        # Putting this here rather than in the class body before
        # Python < 3.10 has fussier rules about staticmethods
        self._SUMMARIZERS = {
            ColumnDisplayType.Boolean: self._summarize_boolean,
            ColumnDisplayType.Number: self._summarize_number,
            ColumnDisplayType.String: self._summarize_string,
            ColumnDisplayType.Date: self._summarize_date,
            ColumnDisplayType.Datetime: self._summarize_datetime,
        }

    def _maybe_wrap(self, value):
        if isinstance(value, pd_.Series):
            if value.name is None:
                return pd_.DataFrame({"unnamed": value})
            else:
                return pd_.DataFrame(value)
        else:
            return value

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
            type_name, type_display = self._get_type(column.dtype, lambda: infer_dtype(column))

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

        def schema_getter(column_name, column_index):
            return _get_column_schema(new_table.iloc[:, column_index], column_name, column_index)

        new_filters = self._get_adjusted_filters(
            new_table.columns,
            schema_changes,
            shifted_columns,
            deleted_columns,
            schema_getter,
        )

        new_sort_keys = self._get_adjusted_sort_keys(
            new_table.columns, schema_changes, shifted_columns, deleted_columns
        )

        return schema_updated, new_filters, new_sort_keys

    def _get_inferred_dtype(self, column_index: int):
        from pandas.api.types import infer_dtype

        if column_index not in self._inferred_dtypes:
            self._inferred_dtypes[column_index] = infer_dtype(self.table.iloc[:, column_index])
        return self._inferred_dtypes[column_index]

    @classmethod
    def _get_type(cls, dtype, get_inferred_dtype):
        # A helper function for returning the backend type_name and
        # the display type when returning schema results or analyzing
        # schema changes

        # TODO: pandas MultiIndex columns
        # TODO: time zone for datetimetz datetime64[ns] types
        if dtype == object:  # noqa: E721
            type_name = get_inferred_dtype()
            type_name = cls.TYPE_NAME_MAPPING.get(type_name, type_name)
        else:
            # TODO: more sophisticated type mapping
            type_name = str(dtype)

        type_display = cls._get_type_display(type_name)
        return type_name, type_display

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
        "complex64": "number",
        "complex128": "number",
        "complex256": "number",
        "mixed-integer": "number",
        "mixed-integer-float": "number",
        "mixed": "object",
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

    TYPE_MAPPERS = [_pandas_datetimetz_mapper]

    @classmethod
    def _get_type_display(cls, type_name):
        if type_name in cls.TYPE_DISPLAY_MAPPING:
            type_display = cls.TYPE_DISPLAY_MAPPING[type_name]
        else:
            type_display = None
            for mapper in cls.TYPE_MAPPERS:
                type_display = mapper(type_name)
                if type_display is not None:
                    break

            if type_display is None:
                type_display = "unknown"

        return ColumnDisplayType(type_display)

    def _get_single_column_schema(self, column_index: int):
        column_raw_name = self.table.columns[column_index]
        column_name = str(column_raw_name)

        type_name, type_display = self._get_type(
            self.table.iloc[:, column_index].dtype,
            lambda: self._get_inferred_dtype(column_index),
        )

        return ColumnSchema(
            column_name=column_name,
            column_index=column_index,
            type_name=type_name,
            type_display=type_display,
        )

    def _get_column_name(self, index: int):
        return str(self.table.columns[index])

    def _get_data_values(
        self,
        row_start: int,
        num_rows: int,
        column_indices: Sequence[int],
        format_options: FormatOptions,
    ) -> dict:
        formatted_columns = []

        column_indices = sorted(column_indices)
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

        formatted_columns = [self._format_values(col, format_options) for col in columns]

        # Currently, we format MultiIndex in its flat tuple
        # representation. In the future we will return multiple lists
        # of row labels to be formatted more nicely in the UI
        if isinstance(self.table.index, pd_.MultiIndex):
            indices = indices.to_flat_index()
        row_labels = [[str(x) for x in indices]]
        # Bypass pydantic model for speed
        return {"columns": formatted_columns, "row_labels": row_labels}

    @classmethod
    def _format_values(cls, values, options: FormatOptions) -> List[ColumnValue]:
        NaT = pd_.NaT
        NA = pd_.NA
        float_format = _get_float_formatter(options)

        def _format_value(x):
            if _is_float_scalar(x):
                if _isnan(x):
                    return _VALUE_NAN
                elif _isinf(x):
                    return _VALUE_INF if x > 0 else _VALUE_NEGINF
                else:
                    return float_format(x)
            elif x is None:
                return _VALUE_NONE
            elif x is NaT:
                return _VALUE_NAT
            elif x is NA:
                return _VALUE_NA
            else:
                return str(x)

        return [_format_value(x) for x in values]

    def _export_tabular(self, row_selector, column_selector, fmt: ExportFormat):
        from io import StringIO

        if self.view_indices is not None:
            row_selector = self.view_indices[row_selector]

        to_export = self.table.iloc[row_selector, column_selector]
        buf = StringIO()

        if fmt == ExportFormat.Csv:
            to_export.to_csv(buf, index=False)
        elif fmt == ExportFormat.Tsv:
            to_export.to_csv(buf, sep="\t", index=False)
        elif fmt == ExportFormat.Html:
            to_export.to_html(buf, index=False)
        else:
            raise NotImplementedError(f"Unsupported export format {fmt}")

        result = buf.getvalue()

        # pandas will put a line break at the end of CSV data. If
        # present, remove it
        if result[-1] == "\n":
            result = result[:-1]

        return ExportedData(data=result, format=fmt).dict()

    def _export_cell(self, row_index: int, column_index: int, fmt: ExportFormat):
        return ExportedData(data=str(self.table.iat[row_index, column_index]), format=fmt).dict()

    def _mask_to_indices(self, mask):
        if mask is not None:
            return mask.nonzero()[0]

    def _eval_filter(self, filt: RowFilter):
        column_index = filt.column_schema.column_index
        col = self.table.iloc[:, column_index]

        dtype = col.dtype
        inferred_type = self._get_inferred_dtype(column_index)

        mask = None
        if filt.filter_type in (
            RowFilterType.Between,
            RowFilterType.NotBetween,
        ):
            params = filt.params
            assert isinstance(params, FilterBetween)
            left_value = self._coerce_value(params.left_value, dtype, inferred_type)
            right_value = self._coerce_value(params.right_value, dtype, inferred_type)
            if filt.filter_type == RowFilterType.Between:
                mask = (col >= left_value) & (col <= right_value)
            else:
                # NotBetween
                mask = (col < left_value) | (col > right_value)
        elif filt.filter_type == RowFilterType.Compare:
            params = filt.params
            assert isinstance(params, FilterComparison)

            if params.op not in COMPARE_OPS:
                raise ValueError(f"Unsupported filter type: {params.op}")
            op = COMPARE_OPS[params.op]
            # pandas comparison filters return False for null values
            mask = op(col, self._coerce_value(params.value, dtype, inferred_type))
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
            params = filt.params
            assert isinstance(params, FilterSetMembership)
            boxed_values = pd_.Series(
                [self._coerce_value(val, dtype, inferred_type) for val in params.values]
            )
            # IN
            mask = col.isin(boxed_values)
            if not params.inclusive:
                # NOT-IN
                mask = ~mask
        elif filt.filter_type == RowFilterType.Search:
            params = filt.params
            assert isinstance(params, FilterTextSearch)

            if inferred_type != "string":
                col = col.astype(str)

            term = params.term

            if params.search_type == TextSearchType.RegexMatch:
                mask = col.str.match(term, case=params.case_sensitive)
            else:
                if not params.case_sensitive:
                    col = col.str.lower()
                    term = term.lower()
                if params.search_type == TextSearchType.Contains:
                    mask = col.str.contains(term)
                elif params.search_type == TextSearchType.StartsWith:
                    mask = col.str.startswith(term)
                elif params.search_type == TextSearchType.EndsWith:
                    mask = col.str.endswith(term)

        assert mask is not None

        # Nulls are possible in the mask, so we just fill them if any
        if mask.dtype != bool:
            mask[mask.isna()] = False
            mask = mask.astype(bool)

        return mask.to_numpy()

    @staticmethod
    def _coerce_value(value, dtype, inferred_type):
        import pandas.api.types as pat

        if pat.is_integer_dtype(dtype):
            # For integer types, try to coerce to integer, but if this
            # fails, allow a looser conversion to float
            try:
                return int(value)
            except ValueError as e1:
                try:
                    return pd_.Series([value], dtype="float64").iloc[0]
                except ValueError:
                    raise e1
        elif pat.is_bool_dtype(dtype):
            lvalue = value.lower()
            if lvalue == "true":
                return True
            elif lvalue == "false":
                return False
            else:
                raise ValueError(f"Unable to convert {value} to boolean")
        elif "datetime" in inferred_type:
            return _parse_iso8601_like(value, tz=getattr(dtype, "tz", None))
        else:
            # As a fallback, let Series.astype do the coercion
            dummy = pd_.Series([value])
            if dummy.dtype != dtype:
                dummy = dummy.astype(dtype)
            return dummy.iloc[0]

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

    def _prof_summary_stats(self, column_index: int, options: FormatOptions):
        col_schema = self._get_single_column_schema(column_index)
        col = self._get_column(column_index)

        ui_type = col_schema.type_display
        handler = self._SUMMARIZERS.get(ui_type)

        if handler is None:
            # Return nothing for types we don't yet know how to summarize
            return ColumnSummaryStats(type_display=ui_type)
        else:
            return handler(col, options)

    @classmethod
    def _summarize_number(cls, col: "pd.Series", options: FormatOptions):
        float_format = _get_float_formatter(options)

        median_val = mean_val = std_val = None

        if "complex" in str(col.dtype):
            min_val = max_val = None
            values = col.to_numpy()
            non_null_values = values[~np_.isnan(values)]
            if len(non_null_values) > 0:
                median_val = float_format(np_.median(non_null_values))
                mean_val = float_format(np_.mean(non_null_values))
        else:
            min_val = col.min()
            max_val = col.max()

            if not _isinf(min_val) and not _isinf(max_val):
                # These stats are not defined when there is an
                # inf/-inf in the data
                mean_val = float_format(col.mean())
                median_val = float_format(col.median())
                std_val = float_format(col.std())

            # Format the min/max
            min_val = float_format(min_val)
            max_val = float_format(max_val)

        return ColumnSummaryStats(
            type_display=ColumnDisplayType.Number,
            number_stats=SummaryStatsNumber(
                min_value=min_val,
                max_value=max_val,
                mean=mean_val,
                median=median_val,
                stdev=std_val,
            ),
        )

    @staticmethod
    def _summarize_string(col: "pd.Series", options: FormatOptions):
        num_empty = (col.str.len() == 0).sum()
        num_unique = col.nunique()

        return ColumnSummaryStats(
            type_display=ColumnDisplayType.String,
            string_stats=SummaryStatsString(num_empty=int(num_empty), num_unique=int(num_unique)),
        )

    @staticmethod
    def _summarize_boolean(col: "pd.Series", options: FormatOptions):
        null_count = col.isnull().sum()
        true_count = col.sum()
        false_count = len(col) - true_count - null_count

        return ColumnSummaryStats(
            type_display=ColumnDisplayType.Boolean,
            boolean_stats=SummaryStatsBoolean(
                true_count=int(true_count), false_count=int(false_count)
            ),
        )

    @staticmethod
    def _summarize_date(col: "pd.Series", options: FormatOptions):
        col_dttm = pd_.to_datetime(col)
        min_date = col.min()
        mean_date = pd_.to_datetime(col_dttm.mean()).date()
        median_date = _date_median(col_dttm)
        max_date = col.max()
        num_unique = col.nunique()

        def format_date(x):
            return x.strftime("%Y-%m-%d")

        return ColumnSummaryStats(
            type_display=ColumnDisplayType.Date,
            date_stats=SummaryStatsDate(
                num_unique=int(num_unique),
                min_date=format_date(min_date),
                mean_date=format_date(mean_date),
                median_date=format_date(median_date),
                max_date=format_date(max_date),
            ),
        )

    @staticmethod
    def _summarize_datetime(col: "pd.Series", options: FormatOptions):
        # when there are mixed timezones in a single column, it's
        # possible that any of the operations below can
        # fail. specially if they mix timezone aware datetimes with
        # naive datetimes.

        # if an error happens we return `None` as the field value.
        min_date = _possibly(col.min)
        mean_date = _possibly(col.mean)
        median_date = _possibly(lambda: _date_median(col))
        max_date = _possibly(col.max)

        num_unique = _possibly(col.nunique)

        def format_date(x):
            return str(x)

        timezones = col.apply(lambda x: x.tz).unique()
        if len(timezones) == 1:
            timezone = str(timezones[0])
        else:
            timezone = [f"{str(x)}" for x in timezones[:2]]
            timezone = ", ".join(timezone)
            if len(timezones) > 2:
                timezone = timezone + f", ... ({len(timezones) - 2} more)"

        return ColumnSummaryStats(
            type_display=ColumnDisplayType.Datetime,
            datetime_stats=SummaryStatsDatetime(
                num_unique=num_unique,
                min_date=format_date(min_date),
                mean_date=format_date(mean_date),
                median_date=format_date(median_date),
                max_date=format_date(max_date),
                timezone=timezone,
            ),
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
        search_schema=SearchSchemaFeatures(
            support_status=SupportStatus.Supported,
            supported_types=[
                ColumnFilterTypeSupportStatus(
                    column_filter_type=ColumnFilterType.TextSearch,
                    support_status=SupportStatus.Supported,
                ),
                ColumnFilterTypeSupportStatus(
                    column_filter_type=ColumnFilterType.MatchDataTypes,
                    support_status=SupportStatus.Supported,
                ),
            ],
        ),
        set_row_filters=SetRowFiltersFeatures(
            support_status=SupportStatus.Supported,
            # Temporarily disabled for https://github.com/posit-dev/positron/issues/3489 on
            # 6/11/2024. This will be enabled again when the UI has been reworked to support
            # grouping.
            supports_conditions=SupportStatus.Unsupported,
            supported_types=[
                RowFilterTypeSupportStatus(
                    row_filter_type=x, support_status=SupportStatus.Supported
                )
                for x in SUPPORTED_FILTERS
            ],
        ),
        get_column_profiles=GetColumnProfilesFeatures(
            support_status=SupportStatus.Supported,
            supported_types=[
                ColumnProfileTypeSupportStatus(
                    profile_type=ColumnProfileType.NullCount,
                    support_status=SupportStatus.Supported,
                ),
                # Temporarily disabled for https://github.com/posit-dev/positron/issues/3490
                # on 6/11/2024. This will be enabled again when the UI has been reworked to
                # more fully support column profiles.
                ColumnProfileTypeSupportStatus(
                    profile_type=ColumnProfileType.SummaryStats,
                    support_status=SupportStatus.Experimental,
                ),
            ],
        ),
        set_sort_columns=SetSortColumnsFeatures(support_status=SupportStatus.Supported),
        export_data_selection=ExportDataSelectionFeatures(
            support_status=SupportStatus.Supported,
            supported_formats=[
                ExportFormat.Csv,
                ExportFormat.Tsv,
                ExportFormat.Html,
            ],
        ),
    )


COMPARE_OPS = {
    FilterComparisonOp.Gt: operator.gt,
    FilterComparisonOp.GtEq: operator.ge,
    FilterComparisonOp.Lt: operator.lt,
    FilterComparisonOp.LtEq: operator.le,
    FilterComparisonOp.Eq: operator.eq,
    FilterComparisonOp.NotEq: operator.ne,
}


def _date_median(x):
    """
    Computes the median of a date or datetime series

    It converts to the integer representation of the datetime,
    then computes the median, and then converts back to a datetime
    """
    # the np_.array calls are required to please pyright
    median_date = np_.median(np_.array(pd_.to_numeric(x)))
    out = pd_.to_datetime(np_.array(median_date), utc=True)
    return out.tz_convert(x[0].tz)


def _possibly(f, otherwise=None):
    """
    Executes a function an if an error occurs, returns `otherwise`.
    """
    try:
        return f()
    except Exception:
        return otherwise


_ISO_8601_FORMATS = [
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d %H:%M",
    "%Y-%m-%d",
]


def _parse_iso8601_like(x, tz=None):
    import pytz

    for fmt in _ISO_8601_FORMATS:
        try:
            result = datetime.strptime(x, fmt)

            # Localize tz-naive datetime if needed to avoid TypeError
            if tz is not None:
                if isinstance(tz, str):
                    tz = pytz.timezone(tz)
                result = result.replace(tzinfo=tz)

            return result
        except ValueError:
            continue

    raise ValueError(f'"{x}" not ISO8601 YYYY-MM-DD HH:MM:SS format')


class PolarsView(DataExplorerTableView):
    def __init__(
        self,
        display_name: str,
        table: "pl.DataFrame",
        filters: Optional[List[RowFilter]],
        sort_keys: Optional[List[ColumnSortKey]],
    ):
        super().__init__(display_name, table, filters, sort_keys)

    def get_updated_state(self, new_table) -> StateUpdate:
        filtered_columns = {
            filt.column_schema.column_index: filt.column_schema for filt in self.filters
        }

        # As of June 2024, polars seems to be really slow for
        # inspecting the metadata of data frames with a large amount
        # of columns. DataFrame.columns, DataFrame.schema, etc. are
        # fairly expensive. Until this changes (or we add some methods
        # in polars to do the metadata comparisons that we need in
        # Rust), we have to be pretty conservative about how much
        # metadata we touch.
        #
        # Note also the syntax "column_name in df" is fairly slow

        INSPECT_THRESHOLD = 1_000
        if new_table.shape[1] > INSPECT_THRESHOLD:
            # We always say the schema was updated. We'll let filter
            # and sort keys get invalidated by downstream checking
            # rather than proactive invalidation
            return True, self.filters, self.sort_keys

        # self.table may have been modified in place, so we cannot
        # assume that new_table is different than self.table
        if new_table is self.table:
            # For in-place updates, we have to assume the worst case
            # scenario of a schema change since we do not have access
            # to the previous schema
            schema_updated = True
        else:
            # The table object has changed -- now we look for
            # suspected schema changes
            schema_updated = False

        # We go through the columns in the new table and see whether
        # there is a type change or whether a column name moved.
        shifted_columns: Dict[int, int] = {}
        deleted_columns: Set[int] = set()
        schema_changes: Dict[int, ColumnSchema] = {}

        # When computing the new display type of a column requires
        # calling infer_dtype, we are careful to only do it for
        # columns that are involved in a filter
        new_columns = new_table.columns
        new_columns_set = {c: i for i, c in enumerate(new_columns)}
        if new_table is self.table:
            old_columns = new_columns
            old_columns_set = new_columns_set
        else:
            old_columns = self.table.columns
            old_columns_set = {c: i for i, c in enumerate(self.table.columns)}

        for old_index, column in enumerate(old_columns):
            if column not in new_columns_set:
                deleted_columns.add(old_index)
                schema_updated = True

        for new_index, column_name in enumerate(new_columns):
            # New table has more columns than the old table
            out_of_bounds = new_index >= len(old_columns)

            if out_of_bounds or old_columns[new_index] != column_name:
                if column_name not in old_columns_set:
                    # New column
                    schema_updated = True
                    continue
                # Column was shifted
                old_index = old_columns_set[column_name]
                shifted_columns[old_index] = new_index
            else:
                old_index = new_index

            new_column = new_table[:, new_index]

            if new_table is not self.table:
                # While we must proceed under the conservative
                # possibility that the table was modified in place, if
                # the tables are indeed different we can check for
                # schema changes more confidently
                old_dtype = self.table[:, old_index].dtype
                if new_column.dtype == old_dtype:
                    # Type is the same
                    continue
            elif old_index in filtered_columns:
                # If it was an in place modification, as a last ditch
                # effort we check if we remember the data type because
                # of a prior filter
                if filtered_columns[old_index].type_name == str(new_column.dtype):
                    # Type is the same and not object dtype
                    continue

            # The type maybe changed (it could have been an in place
            # update)
            schema_updated = True

            if old_index not in filtered_columns:
                # This column index did not have a row filter
                # attached to it, so doing further analysis is
                # unnecessary
                continue

            schema_changes[old_index] = self._construct_schema(
                new_column, new_index, name=column_name
            )

        def schema_getter(column_name, column_index):
            return self._construct_schema(new_table[:, column_index], column_name, column_index)

        new_filters = self._get_adjusted_filters(
            new_columns,
            schema_changes,
            shifted_columns,
            deleted_columns,
            schema_getter,
        )

        new_sort_keys = self._get_adjusted_sort_keys(
            new_columns, schema_changes, shifted_columns, deleted_columns
        )

        return schema_updated, new_filters, new_sort_keys

    def _get_single_column_schema(self, column_index: int):
        column = self.table[:, column_index]
        return self._construct_schema(column, column_index, name=column.name)

    def _get_column_name(self, column_index: int) -> str:
        return self.table[:, column_index].name

    def _construct_schema(self, column: "pl.Series", column_index: int, name=None):
        type_display = self._get_type_display(column.dtype)

        return ColumnSchema(
            column_name=name,
            column_index=column_index,
            type_name=str(column.dtype),
            type_display=type_display,
        )

    TYPE_DISPLAY_MAPPING = {
        "Boolean": "boolean",
        "Int8": "number",
        "Int16": "number",
        "Int32": "number",
        "Int64": "number",
        "UInt8": "number",
        "UInt16": "number",
        "UInt32": "number",
        "UInt64": "number",
        "Float32": "number",
        "Float64": "number",
        "Binary": "string",
        "String": "string",
        "Date": "date",
        "Datetime": "datetime",
        "Time": "time",
        "Decimal": "number",
        "Object": "object",
        "List": "array",
        "Struct": "struct",
        "Categorical": "unknown",  # See #3417
        "Duration": "unknown",  # See #3418
        "Enum": "unknown",
        "Null": "unknown",  # Not yet implemented
        "Unknown": "unknown",
    }

    @classmethod
    def _get_type_display(cls, dtype: "pl.DataType"):
        key = str(dtype.base_type())
        return cls.TYPE_DISPLAY_MAPPING.get(key, "unknown")

    def _search_schema(
        self, filters: List[ColumnFilter], start_index: int, max_results: int
    ) -> SearchSchemaResult:
        raise NotImplementedError

    def _get_data_values(
        self,
        row_start: int,
        num_rows: int,
        column_indices: Sequence[int],
        format_options: FormatOptions,
    ) -> dict:
        formatted_columns = []
        column_indices = sorted(column_indices)
        columns = []
        for i in column_indices:
            # The UI has requested data beyond the end of the table,
            # so we stop here
            if i >= self.table.shape[1]:
                break
            columns.append(self.table[:, i])

        formatted_columns = []

        if self.view_indices is not None:
            # If the table is either filtered or sorted, use a slice
            # the view_indices to select the virtual range of values
            # for the grid
            view_slice = self.view_indices[row_start : row_start + num_rows]
            columns = [col.gather(view_slice) for col in columns]
        else:
            # No filtering or sorting, just slice
            columns = [col[row_start : row_start + num_rows] for col in columns]

        formatted_columns = [self._format_values(col, format_options) for col in columns]

        # Bypass pydantic model for speed
        return {"columns": formatted_columns, "row_labels": None}

    @classmethod
    def _format_values(cls, values, options: FormatOptions) -> List[ColumnValue]:
        float_format = _get_float_formatter(options)

        def _format_scalar(x):
            if _is_float_scalar(x):
                if _isnan(x):
                    return _VALUE_NAN
                else:
                    return float_format(x)
            else:
                return str(x)

        def _format_series(s):
            result = []
            is_valid_mask = s.is_not_null()
            if s.dtype.base_type() is pl_.List:
                # Special recursive formatting for List types
                for i, v in enumerate(s):
                    if is_valid_mask[i]:
                        inner_values = _format_series(v)
                        result.append(
                            "[" + ", ".join("null" if v == 0 else v for v in inner_values) + "]"
                        )
                    else:
                        result.append(_VALUE_NULL)
            else:
                for i, v in enumerate(s):
                    if is_valid_mask[i]:
                        result.append(_format_scalar(v))
                    else:
                        result.append(_VALUE_NULL)
            return result

        return _format_series(values)

    def _export_tabular(self, row_selector, column_selector, fmt: ExportFormat):
        if self.view_indices is not None:
            row_selector = self.view_indices[row_selector]

        to_export = self.table[row_selector, column_selector]

        if fmt == ExportFormat.Csv:
            result = to_export.write_csv()
        elif fmt == ExportFormat.Tsv:
            result = to_export.write_csv(separator="\t")
        elif fmt == ExportFormat.Html:
            raise NotImplementedError(f"Unsupported export format {fmt}")

        return ExportedData(data=result, format=fmt).dict()

    def _export_cell(self, row_index: int, column_index: int, fmt: ExportFormat):
        return ExportedData(data=str(self.table[row_index, column_index]), format=fmt).dict()

    SUPPORTED_FILTERS = {
        RowFilterType.Between,
        RowFilterType.Compare,
        RowFilterType.NotBetween,
        RowFilterType.IsNull,
        RowFilterType.NotNull,
        RowFilterType.IsEmpty,
        RowFilterType.NotEmpty,
        RowFilterType.IsTrue,
        RowFilterType.IsFalse,
        RowFilterType.Search,
        RowFilterType.SetMembership,
    }

    def _mask_to_indices(self, mask):
        # Boolean array -> int32 array of true indices
        if mask is not None:
            return mask.arg_true()

    def _eval_filter(self, filt: RowFilter):
        column_index = filt.column_schema.column_index
        col = self.table[:, column_index]

        dtype = col.dtype
        display_type = self._get_type_display(dtype)

        mask = None
        if filt.filter_type in (
            RowFilterType.Between,
            RowFilterType.NotBetween,
        ):
            params = filt.params
            assert isinstance(params, FilterBetween)
            left_value = self._coerce_value(params.left_value, dtype, display_type)
            right_value = self._coerce_value(params.right_value, dtype, display_type)
            mask = col.is_between(left_value, right_value)
            if filt.filter_type == RowFilterType.NotBetween:
                mask = ~mask
        elif filt.filter_type == RowFilterType.Compare:
            params = filt.params
            assert isinstance(params, FilterComparison)

            if params.op not in COMPARE_OPS:
                raise ValueError(f"Unsupported filter type: {params.op}")
            op = COMPARE_OPS[params.op]
            # pandas comparison filters return False for null values
            mask = op(col, self._coerce_value(params.value, dtype, display_type))
        elif filt.filter_type == RowFilterType.IsEmpty:
            if col.dtype.is_(pl_.String):
                mask = col.str.len_chars() == 0
            elif col.dtype.is_(pl_.Binary):
                # col == b"" segfaults in polars
                mask = col.bin.encode("hex").str.len_chars() == 0
            else:
                raise TypeError(col.dtype)
        elif filt.filter_type == RowFilterType.NotEmpty:
            if col.dtype.is_(pl_.String):
                mask = col.str.len_chars() != 0
            elif col.dtype.is_(pl_.Binary):
                # col == b"" segfaults in polars
                mask = col.bin.encode("hex").str.len_chars() != 0
            else:
                raise TypeError(col.dtype)
        elif filt.filter_type == RowFilterType.IsNull:
            mask = col.is_null()
        elif filt.filter_type == RowFilterType.NotNull:
            mask = ~col.is_null()
        elif filt.filter_type == RowFilterType.IsTrue:
            mask = col == True  # noqa: E712
        elif filt.filter_type == RowFilterType.IsFalse:
            mask = col == False  # noqa: E712
        elif filt.filter_type == RowFilterType.SetMembership:
            params = filt.params
            assert isinstance(params, FilterSetMembership)

            boxed_values = pl_.Series(
                [self._coerce_value(val, dtype, display_type) for val in params.values]
            )
            mask = col.is_in(boxed_values)
            if not params.inclusive:
                # NOT-IN
                mask = ~mask
        elif filt.filter_type == RowFilterType.Search:
            params = filt.params
            assert isinstance(params, FilterTextSearch)

            if not col.dtype.is_(pl_.String):
                col = col.cast(str)

            term = params.term

            if params.search_type == TextSearchType.RegexMatch:
                if not params.case_sensitive:
                    term = "(?i)" + term
                mask = col.str.contains(term)
            else:
                if not params.case_sensitive:
                    col = col.str.to_lowercase()
                    term = term.lower()
                if params.search_type == TextSearchType.Contains:
                    mask = col.str.contains(term)
                elif params.search_type == TextSearchType.StartsWith:
                    mask = col.str.starts_with(term)
                elif params.search_type == TextSearchType.EndsWith:
                    mask = col.str.ends_with(term)

        assert mask is not None

        # Nulls are possible in the mask, so we just fill them if any
        if mask.null_count() > 0:
            mask[mask.is_null()] = False

        return mask

    @staticmethod
    def _coerce_value(value, dtype, display_type):
        if dtype.is_integer():
            # For integer types, try to coerce to integer, but if this
            # fails, allow a looser conversion to float
            try:
                return int(value)
            except ValueError as e:
                try:
                    return pl_.Series([value]).cast(pl_.Float64)[0]
                except ValueError:
                    raise e
        elif dtype.is_(pl_.Boolean):
            lvalue = value.lower()
            if lvalue == "true":
                return True
            elif lvalue == "false":
                return False
            else:
                raise ValueError(f"Unable to convert {value} to boolean")
        elif display_type == "datetime":
            return _parse_iso8601_like(value, tz=dtype.time_zone)
        else:
            # As a fallback, let polars.Series.cast do the coercion
            dummy = pl_.Series([value])
            if dummy.dtype != dtype:
                dummy = dummy.cast(dtype)
            return dummy[0]

    def _sort_data(self) -> None:
        if len(self.sort_keys) > 0:
            cols_to_sort = []
            directions = []
            for key in self.sort_keys:
                col = self._get_column(key.column_index)
                cols_to_sort.append(col)
                directions.append(not key.ascending)

            indexer_name = guid()

            if self.filtered_indices is not None:
                num_rows = len(self.filtered_indices)
            else:
                num_rows = len(self.table)

            # Do a stable sort of the indices using the columns as sort keys
            to_sort = pl_.DataFrame({indexer_name: pl_.arange(num_rows, eager=True)})

            try:
                to_sort = to_sort.sort(cols_to_sort, descending=directions, maintain_order=True)
            except TypeError:
                # Older versions of polars do not have maintain_order
                to_sort = to_sort.sort(cols_to_sort, descending=directions)

            sort_indexer = to_sort[indexer_name]
            if self.filtered_indices is not None:
                # Create the filtered, sorted virtual view indices
                self.view_indices = self.filtered_indices.gather(sort_indexer)
            else:
                self.view_indices = sort_indexer
        else:
            # No sort keys. This will be None if the data is
            # unfiltered
            self.view_indices = self.filtered_indices

    def _prof_null_count(self, column_index: int) -> int:
        return self._get_column(column_index).null_count()

    def _get_column(self, column_index: int) -> "pl.Series":
        column = self.table[:, column_index]
        if self.filtered_indices is not None:
            column = column.gather(self.filtered_indices)
        return column

    def _prof_summary_stats(self, column_index: int, options: FormatOptions) -> ColumnSummaryStats:
        raise NotImplementedError

    def _prof_freq_table(self, column_index: int) -> ColumnFrequencyTable:
        raise NotImplementedError

    def _prof_histogram(self, column_index: int) -> ColumnHistogram:
        raise NotImplementedError

    FEATURES = SupportedFeatures(
        search_schema=SearchSchemaFeatures(
            support_status=SupportStatus.Unsupported, supported_types=[]
        ),
        set_row_filters=SetRowFiltersFeatures(
            support_status=SupportStatus.Supported,
            supports_conditions=SupportStatus.Unsupported,
            supported_types=[
                RowFilterTypeSupportStatus(
                    row_filter_type=x, support_status=SupportStatus.Supported
                )
                for x in SUPPORTED_FILTERS
            ],
        ),
        get_column_profiles=GetColumnProfilesFeatures(
            support_status=SupportStatus.Supported,
            supported_types=[
                ColumnProfileTypeSupportStatus(
                    profile_type=ColumnProfileType.NullCount,
                    support_status=SupportStatus.Supported,
                ),
                # Temporarily disabled for https://github.com/posit-dev/positron/issues/3490
                # on 6/11/2024. This will be enabled again when the UI has been reworked to
                # more fully support column profiles.
                ColumnProfileTypeSupportStatus(
                    profile_type=ColumnProfileType.SummaryStats,
                    support_status=SupportStatus.Unsupported,
                ),
            ],
        ),
        export_data_selection=ExportDataSelectionFeatures(
            support_status=SupportStatus.Supported,
            supported_formats=[ExportFormat.Csv, ExportFormat.Tsv],
        ),
        set_sort_columns=SetSortColumnsFeatures(support_status=SupportStatus.Supported),
    )


class PyArrowView(DataExplorerTableView):
    pass


def _is_pandas(table):
    return pd_ is not None and isinstance(table, (pd_.DataFrame, pd_.Series))


def _is_polars(table):
    return pl_ is not None and isinstance(table, (pl_.DataFrame, pl_.Series))


def _get_table_view(table, filters=None, sort_keys=None, name=None):
    name = name or guid()

    if _is_pandas(table):
        return PandasView(name, table, filters, sort_keys)
    elif _is_polars(table):
        return PolarsView(name, table, filters, sort_keys)
    else:
        return UnsupportedView(name, table)


def _value_type_is_supported(value):
    if _is_pandas(value):
        return True
    if _is_polars(value):
        return True
    return False


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

    def is_supported(self, value) -> bool:
        return value is not None and _value_type_is_supported(value)

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
        if not _value_type_is_supported(table):
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
        return comm_id

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

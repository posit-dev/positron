#
# Copyright (C) 2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

#
# AUTO-GENERATED from data_explorer.json; do not edit.
#

# flake8: noqa

# For forward declarations
from __future__ import annotations

import enum
from typing import Any, List, Literal, Optional, Union

from ._vendor.pydantic import BaseModel, Field, StrictBool, StrictFloat, StrictInt, StrictStr


@enum.unique
class ColumnDisplayType(str, enum.Enum):
    """
    Possible values for ColumnDisplayType
    """

    Number = "number"

    Boolean = "boolean"

    String = "string"

    Date = "date"

    Datetime = "datetime"

    Time = "time"

    Object = "object"

    Array = "array"

    Struct = "struct"

    Unknown = "unknown"


@enum.unique
class RowFilterCondition(str, enum.Enum):
    """
    Possible values for Condition in RowFilter
    """

    And = "and"

    Or = "or"


@enum.unique
class RowFilterType(str, enum.Enum):
    """
    Possible values for RowFilterType
    """

    Between = "between"

    Compare = "compare"

    IsEmpty = "is_empty"

    IsFalse = "is_false"

    IsNull = "is_null"

    IsTrue = "is_true"

    NotBetween = "not_between"

    NotEmpty = "not_empty"

    NotNull = "not_null"

    Search = "search"

    SetMembership = "set_membership"


@enum.unique
class FilterComparisonOp(str, enum.Enum):
    """
    Possible values for Op in FilterComparison
    """

    Eq = "="

    NotEq = "!="

    Lt = "<"

    LtEq = "<="

    Gt = ">"

    GtEq = ">="


@enum.unique
class TextSearchType(str, enum.Enum):
    """
    Possible values for TextSearchType
    """

    Contains = "contains"

    StartsWith = "starts_with"

    EndsWith = "ends_with"

    RegexMatch = "regex_match"


@enum.unique
class ColumnFilterType(str, enum.Enum):
    """
    Possible values for ColumnFilterType
    """

    TextSearch = "text_search"

    MatchDataTypes = "match_data_types"


@enum.unique
class ColumnProfileType(str, enum.Enum):
    """
    Possible values for ColumnProfileType
    """

    NullCount = "null_count"

    SummaryStats = "summary_stats"

    FrequencyTable = "frequency_table"

    Histogram = "histogram"


@enum.unique
class ColumnHistogramParamsMethod(str, enum.Enum):
    """
    Possible values for Method in ColumnHistogramParams
    """

    Sturges = "sturges"

    FreedmanDiaconis = "freedman_diaconis"

    Scott = "scott"

    Fixed = "fixed"


@enum.unique
class TableSelectionKind(str, enum.Enum):
    """
    Possible values for Kind in TableSelection
    """

    SingleCell = "single_cell"

    CellRange = "cell_range"

    ColumnRange = "column_range"

    RowRange = "row_range"

    ColumnIndices = "column_indices"

    RowIndices = "row_indices"


@enum.unique
class ExportFormat(str, enum.Enum):
    """
    Possible values for ExportFormat
    """

    Csv = "csv"

    Tsv = "tsv"

    Html = "html"


@enum.unique
class SupportStatus(str, enum.Enum):
    """
    Possible values for SupportStatus
    """

    Unsupported = "unsupported"

    Supported = "supported"

    Experimental = "experimental"


class SearchSchemaResult(BaseModel):
    """
    Result in Methods
    """

    matches: TableSchema = Field(
        description="A schema containing matching columns up to the max_results limit",
    )

    total_num_matches: StrictInt = Field(
        description="The total number of columns matching the filter",
    )


class ExportedData(BaseModel):
    """
    Exported result
    """

    data: StrictStr = Field(
        description="Exported data as a string suitable for copy and paste",
    )

    format: ExportFormat = Field(
        description="The exported data format",
    )


class FilterResult(BaseModel):
    """
    The result of applying filters to a table
    """

    selected_num_rows: StrictInt = Field(
        description="Number of rows in table after applying filters",
    )

    had_errors: Optional[StrictBool] = Field(
        default=None,
        description="Flag indicating if there were errors in evaluation",
    )


class BackendState(BaseModel):
    """
    The current backend state for the data explorer
    """

    display_name: StrictStr = Field(
        description="Variable name or other string to display for tab name in UI",
    )

    table_shape: TableShape = Field(
        description="Number of rows and columns in table with row/column filters applied",
    )

    table_unfiltered_shape: TableShape = Field(
        description="Number of rows and columns in table without any filters applied",
    )

    has_row_labels: StrictBool = Field(
        description="Indicates whether table has row labels or whether rows should be labeled by ordinal position",
    )

    column_filters: List[ColumnFilter] = Field(
        description="The currently applied column filters",
    )

    row_filters: List[RowFilter] = Field(
        description="The currently applied row filters",
    )

    sort_keys: List[ColumnSortKey] = Field(
        description="The currently applied column sort keys",
    )

    supported_features: SupportedFeatures = Field(
        description="The features currently supported by the backend instance",
    )


class ColumnSchema(BaseModel):
    """
    Schema for a column in a table
    """

    column_name: StrictStr = Field(
        description="Name of column as UTF-8 string",
    )

    column_index: StrictInt = Field(
        description="The position of the column within the table without any column filters",
    )

    type_name: StrictStr = Field(
        description="Exact name of data type used by underlying table",
    )

    type_display: ColumnDisplayType = Field(
        description="Canonical Positron display name of data type",
    )

    description: Optional[StrictStr] = Field(
        default=None,
        description="Column annotation / description",
    )

    children: Optional[List[ColumnSchema]] = Field(
        default=None,
        description="Schema of nested child types",
    )

    precision: Optional[StrictInt] = Field(
        default=None,
        description="Precision for decimal types",
    )

    scale: Optional[StrictInt] = Field(
        default=None,
        description="Scale for decimal types",
    )

    timezone: Optional[StrictStr] = Field(
        default=None,
        description="Time zone for timestamp with time zone",
    )

    type_size: Optional[StrictInt] = Field(
        default=None,
        description="Size parameter for fixed-size types (list, binary)",
    )


class TableData(BaseModel):
    """
    Table values formatted as strings
    """

    columns: List[List[ColumnValue]] = Field(
        description="The columns of data",
    )


class TableRowLabels(BaseModel):
    """
    Formatted table row labels formatted as strings
    """

    row_labels: List[List[StrictStr]] = Field(
        description="Zero or more arrays of row labels",
    )


class FormatOptions(BaseModel):
    """
    Formatting options for returning data values as strings
    """

    large_num_digits: StrictInt = Field(
        description="Fixed number of decimal places to display for numbers over 1, or in scientific notation",
    )

    small_num_digits: StrictInt = Field(
        description="Fixed number of decimal places to display for small numbers, and to determine lower threshold for switching to scientific notation",
    )

    max_integral_digits: StrictInt = Field(
        description="Maximum number of integral digits to display before switching to scientific notation",
    )

    max_value_length: StrictInt = Field(
        description="Maximum size of formatted value, for truncating large strings or other large formatted values",
    )

    thousands_sep: Optional[StrictStr] = Field(
        default=None,
        description="Thousands separator string",
    )


class TableSchema(BaseModel):
    """
    The schema for a table-like object
    """

    columns: List[ColumnSchema] = Field(
        description="Schema for each column in the table",
    )


class TableShape(BaseModel):
    """
    Provides number of rows and columns in a table
    """

    num_rows: StrictInt = Field(
        description="Numbers of rows in the table",
    )

    num_columns: StrictInt = Field(
        description="Number of columns in the table",
    )


class RowFilter(BaseModel):
    """
    Specifies a table row filter based on a single column's values
    """

    filter_id: StrictStr = Field(
        description="Unique identifier for this filter",
    )

    filter_type: RowFilterType = Field(
        description="Type of row filter to apply",
    )

    column_schema: ColumnSchema = Field(
        description="Column to apply filter to",
    )

    condition: RowFilterCondition = Field(
        description="The binary condition to use to combine with preceding row filters",
    )

    is_valid: Optional[StrictBool] = Field(
        default=None,
        description="Whether the filter is valid and supported by the backend, if undefined then true",
    )

    error_message: Optional[StrictStr] = Field(
        default=None,
        description="Optional error message when the filter is invalid",
    )

    params: Optional[RowFilterParams] = Field(
        default=None,
        description="The row filter type-specific parameters",
    )


class RowFilterTypeSupportStatus(BaseModel):
    """
    Support status for a row filter type
    """

    row_filter_type: RowFilterType = Field(
        description="Type of row filter",
    )

    support_status: SupportStatus = Field(
        description="The support status for this row filter type",
    )


class FilterBetween(BaseModel):
    """
    Parameters for the 'between' and 'not_between' filter types
    """

    left_value: StrictStr = Field(
        description="The lower limit for filtering",
    )

    right_value: StrictStr = Field(
        description="The upper limit for filtering",
    )


class FilterComparison(BaseModel):
    """
    Parameters for the 'compare' filter type
    """

    op: FilterComparisonOp = Field(
        description="String representation of a binary comparison",
    )

    value: StrictStr = Field(
        description="A stringified column value for a comparison filter",
    )


class FilterSetMembership(BaseModel):
    """
    Parameters for the 'set_membership' filter type
    """

    values: List[StrictStr] = Field(
        description="Array of values for a set membership filter",
    )

    inclusive: StrictBool = Field(
        description="Filter by including only values passed (true) or excluding (false)",
    )


class FilterTextSearch(BaseModel):
    """
    Parameters for the 'search' filter type
    """

    search_type: TextSearchType = Field(
        description="Type of search to perform",
    )

    term: StrictStr = Field(
        description="String value/regex to search for",
    )

    case_sensitive: StrictBool = Field(
        description="If true, do a case-sensitive search, otherwise case-insensitive",
    )


class FilterMatchDataTypes(BaseModel):
    """
    Parameters for the 'match_data_types' filter type
    """

    display_types: List[ColumnDisplayType] = Field(
        description="Column display types to match",
    )


class ColumnFilter(BaseModel):
    """
    A filter that selects a subset of columns by name, type, or other
    criteria
    """

    filter_type: ColumnFilterType = Field(
        description="Type of column filter to apply",
    )

    params: ColumnFilterParams = Field(
        description="Parameters for column filter",
    )


class ColumnFilterTypeSupportStatus(BaseModel):
    """
    Support status for a column filter type
    """

    column_filter_type: ColumnFilterType = Field(
        description="Type of column filter",
    )

    support_status: SupportStatus = Field(
        description="The support status for this column filter type",
    )


class ColumnProfileRequest(BaseModel):
    """
    A single column profile request
    """

    column_index: StrictInt = Field(
        description="The column index (absolute, relative to unfiltered table) to profile",
    )

    profiles: List[ColumnProfileSpec] = Field(
        description="Column profiles needed",
    )


class ColumnProfileSpec(BaseModel):
    """
    Parameters for a single column profile for a request for profiles
    """

    profile_type: ColumnProfileType = Field(
        description="Type of column profile",
    )

    params: Optional[ColumnProfileParams] = Field(
        default=None,
        description="Extra parameters for different profile types",
    )


class ColumnProfileTypeSupportStatus(BaseModel):
    """
    Support status for a given column profile type
    """

    profile_type: ColumnProfileType = Field(
        description="The type of analytical column profile",
    )

    support_status: SupportStatus = Field(
        description="The support status for this column profile type",
    )


class ColumnProfileResult(BaseModel):
    """
    Result of computing column profile
    """

    null_count: Optional[StrictInt] = Field(
        default=None,
        description="Result from null_count request",
    )

    summary_stats: Optional[ColumnSummaryStats] = Field(
        default=None,
        description="Results from summary_stats request",
    )

    histogram: Optional[ColumnHistograms] = Field(
        default=None,
        description="Results from histogram request",
    )

    frequency_table: Optional[ColumnFrequencyTable] = Field(
        default=None,
        description="Results from frequency_table request",
    )


class ColumnSummaryStats(BaseModel):
    """
    Profile result containing summary stats for a column based on the data
    type
    """

    type_display: ColumnDisplayType = Field(
        description="Canonical Positron display name of data type",
    )

    number_stats: Optional[SummaryStatsNumber] = Field(
        default=None,
        description="Statistics for a numeric data type",
    )

    string_stats: Optional[SummaryStatsString] = Field(
        default=None,
        description="Statistics for a string-like data type",
    )

    boolean_stats: Optional[SummaryStatsBoolean] = Field(
        default=None,
        description="Statistics for a boolean data type",
    )

    date_stats: Optional[SummaryStatsDate] = Field(
        default=None,
        description="Statistics for a date data type",
    )

    datetime_stats: Optional[SummaryStatsDatetime] = Field(
        default=None,
        description="Statistics for a datetime data type",
    )


class SummaryStatsNumber(BaseModel):
    """
    SummaryStatsNumber in Schemas
    """

    min_value: Optional[StrictStr] = Field(
        default=None,
        description="Minimum value as string",
    )

    max_value: Optional[StrictStr] = Field(
        default=None,
        description="Maximum value as string",
    )

    mean: Optional[StrictStr] = Field(
        default=None,
        description="Average value as string",
    )

    median: Optional[StrictStr] = Field(
        default=None,
        description="Sample median (50% value) value as string",
    )

    stdev: Optional[StrictStr] = Field(
        default=None,
        description="Sample standard deviation as a string",
    )


class SummaryStatsBoolean(BaseModel):
    """
    SummaryStatsBoolean in Schemas
    """

    true_count: StrictInt = Field(
        description="The number of non-null true values",
    )

    false_count: StrictInt = Field(
        description="The number of non-null false values",
    )


class SummaryStatsString(BaseModel):
    """
    SummaryStatsString in Schemas
    """

    num_empty: StrictInt = Field(
        description="The number of empty / length-zero values",
    )

    num_unique: StrictInt = Field(
        description="The exact number of distinct values",
    )


class SummaryStatsDate(BaseModel):
    """
    SummaryStatsDate in Schemas
    """

    num_unique: StrictInt = Field(
        description="The exact number of distinct values",
    )

    min_date: StrictStr = Field(
        description="Minimum date value as string",
    )

    mean_date: StrictStr = Field(
        description="Average date value as string",
    )

    median_date: StrictStr = Field(
        description="Sample median (50% value) date value as string",
    )

    max_date: StrictStr = Field(
        description="Maximum date value as string",
    )


class SummaryStatsDatetime(BaseModel):
    """
    SummaryStatsDatetime in Schemas
    """

    num_unique: StrictInt = Field(
        description="The exact number of distinct values",
    )

    min_date: StrictStr = Field(
        description="Minimum date value as string",
    )

    mean_date: StrictStr = Field(
        description="Average date value as string",
    )

    median_date: StrictStr = Field(
        description="Sample median (50% value) date value as string",
    )

    max_date: StrictStr = Field(
        description="Maximum date value as string",
    )

    timezone: Optional[StrictStr] = Field(
        default=None,
        description="Time zone for timestamp with time zone",
    )


class ColumnHistogramsParams(BaseModel):
    """
    Parameters to produce histograms for the summary profile
    """

    histogram: ColumnHistogramParams = Field(
        description="Parameters to build the smaller histogram",
    )

    large_histogram: Optional[LargeHistogram] = Field(
        default=None,
        description="Parameters for the larger histogram used when the column is expanded",
    )


class ColumnHistogramParams(BaseModel):
    """
    Parameters for a column histogram profile request
    """

    method: ColumnHistogramParamsMethod = Field(
        description="Method for determining number of bins",
    )

    num_bins: Optional[StrictInt] = Field(
        default=None,
        description="Number of bins in the computed histogram",
    )

    quantiles: Optional[List[Union[StrictInt, StrictFloat]]] = Field(
        default=None,
        description="Sample quantiles (numbers between 0 and 1) to compute along with the histogram",
    )


class ColumnHistograms(BaseModel):
    """
    Result from a histogram profile request
    """

    histogram: ColumnHistogram = Field(
        description="A histogram used as the small sparkline plot.",
    )

    large_histogram: Optional[ColumnHistogram] = Field(
        default=None,
        description="A larger histogram, used when the column is expanded in the summary profile",
    )


class ColumnHistogram(BaseModel):
    """
    A histogram object. Contains all necessary information to draw an
    histogram
    """

    bin_edges: List[StrictStr] = Field(
        description="String-formatted versions of the bin edges, there are N + 1 where N is the number of bins",
    )

    bin_counts: List[StrictInt] = Field(
        description="Absolute count of values in each histogram bin",
    )

    quantiles: List[ColumnQuantileValue] = Field(
        description="Sample quantiles that were also requested",
    )


class ColumnFrequencyTableParams(BaseModel):
    """
    Parameters for a frequency_table profile request
    """

    limit: StrictInt = Field(
        description="Number of most frequently-occurring values to return. The K in TopK",
    )


class ColumnFrequencyTable(BaseModel):
    """
    Result from a frequency_table profile request
    """

    values: List[StrictStr] = Field(
        description="The formatted top values",
    )

    counts: List[StrictInt] = Field(
        description="Counts of top values",
    )

    other_count: Optional[StrictInt] = Field(
        default=None,
        description="Number of other values not accounted for in counts, excluding nulls/NA values. May be omitted",
    )


class ColumnQuantileValue(BaseModel):
    """
    An exact or approximate quantile value from a column
    """

    q: Union[StrictInt, StrictFloat] = Field(
        description="Quantile number; a number between 0 and 1",
    )

    value: StrictStr = Field(
        description="Stringified quantile value",
    )

    exact: StrictBool = Field(
        description="Whether value is exact or approximate (computed from binned data or sketches)",
    )


class ColumnSortKey(BaseModel):
    """
    Specifies a column to sort by
    """

    column_index: StrictInt = Field(
        description="Column index (absolute, relative to unfiltered table) to sort by",
    )

    ascending: StrictBool = Field(
        description="Sort order, ascending (true) or descending (false)",
    )


class SupportedFeatures(BaseModel):
    """
    For each field, returns flags indicating supported features
    """

    search_schema: SearchSchemaFeatures = Field(
        description="Support for 'search_schema' RPC and its features",
    )

    set_column_filters: SetColumnFiltersFeatures = Field(
        description="Support ofr 'set_column_filters' RPC and its features",
    )

    set_row_filters: SetRowFiltersFeatures = Field(
        description="Support for 'set_row_filters' RPC and its features",
    )

    get_column_profiles: GetColumnProfilesFeatures = Field(
        description="Support for 'get_column_profiles' RPC and its features",
    )

    set_sort_columns: SetSortColumnsFeatures = Field(
        description="Support for 'set_sort_columns' RPC and its features",
    )

    export_data_selection: ExportDataSelectionFeatures = Field(
        description="Support for 'export_data_selection' RPC and its features",
    )


class SearchSchemaFeatures(BaseModel):
    """
    Feature flags for 'search_schema' RPC
    """

    support_status: SupportStatus = Field(
        description="The support status for this RPC method",
    )

    supported_types: List[ColumnFilterTypeSupportStatus] = Field(
        description="A list of supported types",
    )


class SetColumnFiltersFeatures(BaseModel):
    """
    Feature flags for 'set_column_filters' RPC
    """

    support_status: SupportStatus = Field(
        description="The support status for this RPC method",
    )

    supported_types: List[ColumnFilterTypeSupportStatus] = Field(
        description="A list of supported types",
    )


class SetRowFiltersFeatures(BaseModel):
    """
    Feature flags for 'set_row_filters' RPC
    """

    support_status: SupportStatus = Field(
        description="The support status for this RPC method",
    )

    supports_conditions: SupportStatus = Field(
        description="Whether AND/OR filter conditions are supported",
    )

    supported_types: List[RowFilterTypeSupportStatus] = Field(
        description="A list of supported types",
    )


class GetColumnProfilesFeatures(BaseModel):
    """
    Feature flags for 'get_column_profiles' RPC
    """

    support_status: SupportStatus = Field(
        description="The support status for this RPC method",
    )

    supported_types: List[ColumnProfileTypeSupportStatus] = Field(
        description="A list of supported types",
    )


class ExportDataSelectionFeatures(BaseModel):
    """
    Feature flags for 'export_data_selction' RPC
    """

    support_status: SupportStatus = Field(
        description="The support status for this RPC method",
    )

    supported_formats: List[ExportFormat] = Field(
        description="Export formats supported",
    )


class SetSortColumnsFeatures(BaseModel):
    """
    Feature flags for 'set_sort_columns' RPC
    """

    support_status: SupportStatus = Field(
        description="The support status for this RPC method",
    )


class TableSelection(BaseModel):
    """
    A selection on the data grid, for copying to the clipboard or other
    actions
    """

    kind: TableSelectionKind = Field(
        description="Type of selection, all indices relative to filtered row/column indices",
    )

    selection: Selection = Field(
        description="A union of selection types",
    )


class DataSelectionSingleCell(BaseModel):
    """
    A selection that contains a single data cell
    """

    row_index: StrictInt = Field(
        description="The selected row index",
    )

    column_index: StrictInt = Field(
        description="The selected column index",
    )


class DataSelectionCellRange(BaseModel):
    """
    A selection that contains a rectangular range of data cells
    """

    first_row_index: StrictInt = Field(
        description="The starting selected row index (inclusive)",
    )

    last_row_index: StrictInt = Field(
        description="The final selected row index (inclusive)",
    )

    first_column_index: StrictInt = Field(
        description="The starting selected column index (inclusive)",
    )

    last_column_index: StrictInt = Field(
        description="The final selected column index (inclusive)",
    )


class DataSelectionRange(BaseModel):
    """
    A contiguous selection bounded by inclusive start and end indices
    """

    first_index: StrictInt = Field(
        description="The starting selected index (inclusive)",
    )

    last_index: StrictInt = Field(
        description="The final selected index (inclusive)",
    )


class DataSelectionIndices(BaseModel):
    """
    A selection defined by a sequence of indices to include
    """

    indices: List[StrictInt] = Field(
        description="The selected indices",
    )


class ColumnSelection(BaseModel):
    """
    A union of different selection types for column values
    """

    column_index: StrictInt = Field(
        description="Column index (relative to unfiltered schema) to select data from",
    )

    spec: ArraySelection = Field(
        description="Union of selection specifications for array_selection",
    )


# ColumnValue
ColumnValue = Union[
    StrictInt,
    StrictStr,
]
# Union of row filter parameters
RowFilterParams = Union[
    FilterBetween,
    FilterComparison,
    FilterTextSearch,
    FilterSetMembership,
]
# Union of column filter type-specific parameters
ColumnFilterParams = Union[
    FilterTextSearch,
    FilterMatchDataTypes,
]
# Extra parameters for different profile types
ColumnProfileParams = Union[
    ColumnHistogramsParams,
    ColumnFrequencyTableParams,
]
# Parameters for the larger histogram used when the column is expanded
LargeHistogram = Union[
    Union[StrictInt, StrictFloat],
    ColumnHistogramParams,
]
# A union of selection types
Selection = Union[
    DataSelectionSingleCell,
    DataSelectionCellRange,
    DataSelectionRange,
    DataSelectionIndices,
]
# Union of selection specifications for array_selection
ArraySelection = Union[
    DataSelectionRange,
    DataSelectionIndices,
]


@enum.unique
class DataExplorerBackendRequest(str, enum.Enum):
    """
    An enumeration of all the possible requests that can be sent to the backend data_explorer comm.
    """

    # Request schema
    GetSchema = "get_schema"

    # Search full, unfiltered table schema with column filters
    SearchSchema = "search_schema"

    # Request formatted values from table columns
    GetDataValues = "get_data_values"

    # Request formatted row labels from table
    GetRowLabels = "get_row_labels"

    # Export data selection as a string in different formats
    ExportDataSelection = "export_data_selection"

    # Set column filters to select subset of table columns
    SetColumnFilters = "set_column_filters"

    # Set row filters based on column values
    SetRowFilters = "set_row_filters"

    # Set or clear sort-by-column(s)
    SetSortColumns = "set_sort_columns"

    # Request a batch of column profiles
    GetColumnProfiles = "get_column_profiles"

    # Get the state
    GetState = "get_state"


class GetSchemaParams(BaseModel):
    """
    Request subset of column schemas for a table-like object
    """

    column_indices: List[StrictInt] = Field(
        description="The column indices (relative to the filtered/selected columns) to fetch",
    )


class GetSchemaRequest(BaseModel):
    """
    Request subset of column schemas for a table-like object
    """

    params: GetSchemaParams = Field(
        description="Parameters to the GetSchema method",
    )

    method: Literal[DataExplorerBackendRequest.GetSchema] = Field(
        description="The JSON-RPC method name (get_schema)",
    )

    jsonrpc: str = Field(
        default="2.0",
        description="The JSON-RPC version specifier",
    )


class SearchSchemaParams(BaseModel):
    """
    Search full, unfiltered table schema for column names matching one or
    more column filters
    """

    filters: List[ColumnFilter] = Field(
        description="Column filters to apply when searching",
    )

    start_index: StrictInt = Field(
        description="Index (starting from zero) of first result to fetch (for paging)",
    )

    max_results: StrictInt = Field(
        description="Maximum number of resulting column schemas to fetch from the start index",
    )


class SearchSchemaRequest(BaseModel):
    """
    Search full, unfiltered table schema for column names matching one or
    more column filters
    """

    params: SearchSchemaParams = Field(
        description="Parameters to the SearchSchema method",
    )

    method: Literal[DataExplorerBackendRequest.SearchSchema] = Field(
        description="The JSON-RPC method name (search_schema)",
    )

    jsonrpc: str = Field(
        default="2.0",
        description="The JSON-RPC version specifier",
    )


class GetDataValuesParams(BaseModel):
    """
    Request data from table columns with values formatted as strings
    """

    columns: List[ColumnSelection] = Field(
        description="Array of column selections",
    )

    format_options: FormatOptions = Field(
        description="Formatting options for returning data values as strings",
    )


class GetDataValuesRequest(BaseModel):
    """
    Request data from table columns with values formatted as strings
    """

    params: GetDataValuesParams = Field(
        description="Parameters to the GetDataValues method",
    )

    method: Literal[DataExplorerBackendRequest.GetDataValues] = Field(
        description="The JSON-RPC method name (get_data_values)",
    )

    jsonrpc: str = Field(
        default="2.0",
        description="The JSON-RPC version specifier",
    )


class GetRowLabelsParams(BaseModel):
    """
    Request formatted row labels from table
    """

    selection: ArraySelection = Field(
        description="Selection of row labels",
    )

    format_options: FormatOptions = Field(
        description="Formatting options for returning labels as strings",
    )


class GetRowLabelsRequest(BaseModel):
    """
    Request formatted row labels from table
    """

    params: GetRowLabelsParams = Field(
        description="Parameters to the GetRowLabels method",
    )

    method: Literal[DataExplorerBackendRequest.GetRowLabels] = Field(
        description="The JSON-RPC method name (get_row_labels)",
    )

    jsonrpc: str = Field(
        default="2.0",
        description="The JSON-RPC version specifier",
    )


class ExportDataSelectionParams(BaseModel):
    """
    Export data selection as a string in different formats like CSV, TSV,
    HTML
    """

    selection: TableSelection = Field(
        description="The data selection",
    )

    format: ExportFormat = Field(
        description="Result string format",
    )


class ExportDataSelectionRequest(BaseModel):
    """
    Export data selection as a string in different formats like CSV, TSV,
    HTML
    """

    params: ExportDataSelectionParams = Field(
        description="Parameters to the ExportDataSelection method",
    )

    method: Literal[DataExplorerBackendRequest.ExportDataSelection] = Field(
        description="The JSON-RPC method name (export_data_selection)",
    )

    jsonrpc: str = Field(
        default="2.0",
        description="The JSON-RPC version specifier",
    )


class SetColumnFiltersParams(BaseModel):
    """
    Set or clear column filters on table, replacing any previous filters
    """

    filters: List[ColumnFilter] = Field(
        description="Column filters to apply (or pass empty array to clear column filters)",
    )


class SetColumnFiltersRequest(BaseModel):
    """
    Set or clear column filters on table, replacing any previous filters
    """

    params: SetColumnFiltersParams = Field(
        description="Parameters to the SetColumnFilters method",
    )

    method: Literal[DataExplorerBackendRequest.SetColumnFilters] = Field(
        description="The JSON-RPC method name (set_column_filters)",
    )

    jsonrpc: str = Field(
        default="2.0",
        description="The JSON-RPC version specifier",
    )


class SetRowFiltersParams(BaseModel):
    """
    Row filters to apply (or pass empty array to clear row filters)
    """

    filters: List[RowFilter] = Field(
        description="Zero or more filters to apply",
    )


class SetRowFiltersRequest(BaseModel):
    """
    Row filters to apply (or pass empty array to clear row filters)
    """

    params: SetRowFiltersParams = Field(
        description="Parameters to the SetRowFilters method",
    )

    method: Literal[DataExplorerBackendRequest.SetRowFilters] = Field(
        description="The JSON-RPC method name (set_row_filters)",
    )

    jsonrpc: str = Field(
        default="2.0",
        description="The JSON-RPC version specifier",
    )


class SetSortColumnsParams(BaseModel):
    """
    Set or clear the columns(s) to sort by, replacing any previous sort
    columns
    """

    sort_keys: List[ColumnSortKey] = Field(
        description="Pass zero or more keys to sort by. Clears any existing keys",
    )


class SetSortColumnsRequest(BaseModel):
    """
    Set or clear the columns(s) to sort by, replacing any previous sort
    columns
    """

    params: SetSortColumnsParams = Field(
        description="Parameters to the SetSortColumns method",
    )

    method: Literal[DataExplorerBackendRequest.SetSortColumns] = Field(
        description="The JSON-RPC method name (set_sort_columns)",
    )

    jsonrpc: str = Field(
        default="2.0",
        description="The JSON-RPC version specifier",
    )


class GetColumnProfilesParams(BaseModel):
    """
    Requests a statistical summary or data profile for batch of columns
    """

    profiles: List[ColumnProfileRequest] = Field(
        description="Array of requested profiles",
    )

    format_options: FormatOptions = Field(
        description="Formatting options for returning data values as strings",
    )


class GetColumnProfilesRequest(BaseModel):
    """
    Requests a statistical summary or data profile for batch of columns
    """

    params: GetColumnProfilesParams = Field(
        description="Parameters to the GetColumnProfiles method",
    )

    method: Literal[DataExplorerBackendRequest.GetColumnProfiles] = Field(
        description="The JSON-RPC method name (get_column_profiles)",
    )

    jsonrpc: str = Field(
        default="2.0",
        description="The JSON-RPC version specifier",
    )


class GetStateRequest(BaseModel):
    """
    Request the current backend state (table metadata, explorer state, and
    features)
    """

    method: Literal[DataExplorerBackendRequest.GetState] = Field(
        description="The JSON-RPC method name (get_state)",
    )

    jsonrpc: str = Field(
        default="2.0",
        description="The JSON-RPC version specifier",
    )


class DataExplorerBackendMessageContent(BaseModel):
    comm_id: str
    data: Union[
        GetSchemaRequest,
        SearchSchemaRequest,
        GetDataValuesRequest,
        GetRowLabelsRequest,
        ExportDataSelectionRequest,
        SetColumnFiltersRequest,
        SetRowFiltersRequest,
        SetSortColumnsRequest,
        GetColumnProfilesRequest,
        GetStateRequest,
    ] = Field(..., discriminator="method")


@enum.unique
class DataExplorerFrontendEvent(str, enum.Enum):
    """
    An enumeration of all the possible events that can be sent to the frontend data_explorer comm.
    """

    # Request to sync after a schema change
    SchemaUpdate = "schema_update"

    # Clear cache and request fresh data
    DataUpdate = "data_update"


SearchSchemaResult.update_forward_refs()

ExportedData.update_forward_refs()

FilterResult.update_forward_refs()

BackendState.update_forward_refs()

ColumnSchema.update_forward_refs()

TableData.update_forward_refs()

TableRowLabels.update_forward_refs()

FormatOptions.update_forward_refs()

TableSchema.update_forward_refs()

TableShape.update_forward_refs()

RowFilter.update_forward_refs()

RowFilterTypeSupportStatus.update_forward_refs()

FilterBetween.update_forward_refs()

FilterComparison.update_forward_refs()

FilterSetMembership.update_forward_refs()

FilterTextSearch.update_forward_refs()

FilterMatchDataTypes.update_forward_refs()

ColumnFilter.update_forward_refs()

ColumnFilterTypeSupportStatus.update_forward_refs()

ColumnProfileRequest.update_forward_refs()

ColumnProfileSpec.update_forward_refs()

ColumnProfileTypeSupportStatus.update_forward_refs()

ColumnProfileResult.update_forward_refs()

ColumnSummaryStats.update_forward_refs()

SummaryStatsNumber.update_forward_refs()

SummaryStatsBoolean.update_forward_refs()

SummaryStatsString.update_forward_refs()

SummaryStatsDate.update_forward_refs()

SummaryStatsDatetime.update_forward_refs()

ColumnHistogramsParams.update_forward_refs()

ColumnHistogramParams.update_forward_refs()

ColumnHistograms.update_forward_refs()

ColumnHistogram.update_forward_refs()

ColumnFrequencyTableParams.update_forward_refs()

ColumnFrequencyTable.update_forward_refs()

ColumnQuantileValue.update_forward_refs()

ColumnSortKey.update_forward_refs()

SupportedFeatures.update_forward_refs()

SearchSchemaFeatures.update_forward_refs()

SetColumnFiltersFeatures.update_forward_refs()

SetRowFiltersFeatures.update_forward_refs()

GetColumnProfilesFeatures.update_forward_refs()

ExportDataSelectionFeatures.update_forward_refs()

SetSortColumnsFeatures.update_forward_refs()

TableSelection.update_forward_refs()

DataSelectionSingleCell.update_forward_refs()

DataSelectionCellRange.update_forward_refs()

DataSelectionRange.update_forward_refs()

DataSelectionIndices.update_forward_refs()

ColumnSelection.update_forward_refs()

GetSchemaParams.update_forward_refs()

GetSchemaRequest.update_forward_refs()

SearchSchemaParams.update_forward_refs()

SearchSchemaRequest.update_forward_refs()

GetDataValuesParams.update_forward_refs()

GetDataValuesRequest.update_forward_refs()

GetRowLabelsParams.update_forward_refs()

GetRowLabelsRequest.update_forward_refs()

ExportDataSelectionParams.update_forward_refs()

ExportDataSelectionRequest.update_forward_refs()

SetColumnFiltersParams.update_forward_refs()

SetColumnFiltersRequest.update_forward_refs()

SetRowFiltersParams.update_forward_refs()

SetRowFiltersRequest.update_forward_refs()

SetSortColumnsParams.update_forward_refs()

SetSortColumnsRequest.update_forward_refs()

GetColumnProfilesParams.update_forward_refs()

GetColumnProfilesRequest.update_forward_refs()

GetStateRequest.update_forward_refs()

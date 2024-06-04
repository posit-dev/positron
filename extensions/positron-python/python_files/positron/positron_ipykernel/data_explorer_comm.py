#
# Copyright (C) 2024 Posit Software, PBC. All rights reserved.
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
class CompareFilterParamsOp(str, enum.Enum):
    """
    Possible values for Op in CompareFilterParams
    """

    Eq = "="

    NotEq = "!="

    Lt = "<"

    LtEq = "<="

    Gt = ">"

    GtEq = ">="


@enum.unique
class SearchFilterType(str, enum.Enum):
    """
    Possible values for SearchFilterType
    """

    Contains = "contains"

    StartsWith = "starts_with"

    EndsWith = "ends_with"

    RegexMatch = "regex_match"


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
class DataSelectionKind(str, enum.Enum):
    """
    Possible values for Kind in DataSelection
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


class SearchSchemaResult(BaseModel):
    """
    Result in Methods
    """

    matches: Optional[TableSchema] = Field(
        default=None,
        description="A schema containing matching columns up to the max_results limit",
    )

    total_num_matches: StrictInt = Field(
        description="The total number of columns matching the search term",
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
        description="Number of rows and columns in table with filters applied",
    )

    table_unfiltered_shape: TableShape = Field(
        description="Number of rows and columns in table without any filters applied",
    )

    row_filters: List[RowFilter] = Field(
        description="The set of currently applied row filters",
    )

    sort_keys: List[ColumnSortKey] = Field(
        description="The set of currently applied sorts",
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
        description="The position of the column within the schema",
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

    row_labels: Optional[List[List[StrictStr]]] = Field(
        default=None,
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

    between_params: Optional[BetweenFilterParams] = Field(
        default=None,
        description="Parameters for the 'between' and 'not_between' filter types",
    )

    compare_params: Optional[CompareFilterParams] = Field(
        default=None,
        description="Parameters for the 'compare' filter type",
    )

    search_params: Optional[SearchFilterParams] = Field(
        default=None,
        description="Parameters for the 'search' filter type",
    )

    set_membership_params: Optional[SetMembershipFilterParams] = Field(
        default=None,
        description="Parameters for the 'set_membership' filter type",
    )


class BetweenFilterParams(BaseModel):
    """
    Parameters for the 'between' and 'not_between' filter types
    """

    left_value: StrictStr = Field(
        description="The lower limit for filtering",
    )

    right_value: StrictStr = Field(
        description="The upper limit for filtering",
    )


class CompareFilterParams(BaseModel):
    """
    Parameters for the 'compare' filter type
    """

    op: CompareFilterParamsOp = Field(
        description="String representation of a binary comparison",
    )

    value: StrictStr = Field(
        description="A stringified column value for a comparison filter",
    )


class SetMembershipFilterParams(BaseModel):
    """
    Parameters for the 'set_membership' filter type
    """

    values: List[StrictStr] = Field(
        description="Array of column values for a set membership filter",
    )

    inclusive: StrictBool = Field(
        description="Filter by including only values passed (true) or excluding (false)",
    )


class SearchFilterParams(BaseModel):
    """
    Parameters for the 'search' filter type
    """

    search_type: SearchFilterType = Field(
        description="Type of search to perform",
    )

    term: StrictStr = Field(
        description="String value/regex to search for in stringified data",
    )

    case_sensitive: StrictBool = Field(
        description="If true, do a case-sensitive search, otherwise case-insensitive",
    )


class ColumnProfileRequest(BaseModel):
    """
    A single column profile request
    """

    column_index: StrictInt = Field(
        description="The ordinal column index to profile",
    )

    profile_type: ColumnProfileType = Field(
        description="The type of analytical column profile",
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

    histogram: Optional[ColumnHistogram] = Field(
        default=None,
        description="Results from summary_stats request",
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

    min_value: StrictStr = Field(
        description="Minimum value as string",
    )

    max_value: StrictStr = Field(
        description="Maximum value as string",
    )

    mean: StrictStr = Field(
        description="Average value as string",
    )

    median: StrictStr = Field(
        description="Sample median (50% value) value as string",
    )

    stdev: StrictStr = Field(
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


class ColumnHistogram(BaseModel):
    """
    Result from a histogram profile request
    """

    bin_sizes: List[StrictInt] = Field(
        description="Absolute count of values in each histogram bin",
    )

    bin_width: Union[StrictInt, StrictFloat] = Field(
        description="Absolute floating-point width of a histogram bin",
    )


class ColumnFrequencyTable(BaseModel):
    """
    Result from a frequency_table profile request
    """

    counts: List[ColumnFrequencyTableItem] = Field(
        description="Counts of distinct values in column",
    )

    other_count: StrictInt = Field(
        description="Number of other values not accounted for in counts. May be 0",
    )


class ColumnFrequencyTableItem(BaseModel):
    """
    Entry in a column's frequency table
    """

    value: StrictStr = Field(
        description="Stringified value",
    )

    count: StrictInt = Field(
        description="Number of occurrences of value",
    )


class ColumnQuantileValue(BaseModel):
    """
    An exact or approximate quantile value from a column
    """

    q: Union[StrictInt, StrictFloat] = Field(
        description="Quantile number (percentile). E.g. 1 for 1%, 50 for median",
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
        description="Column index to sort by",
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

    set_row_filters: SetRowFiltersFeatures = Field(
        description="Support for 'set_row_filters' RPC and its features",
    )

    get_column_profiles: GetColumnProfilesFeatures = Field(
        description="Support for 'get_column_profiles' RPC and its features",
    )


class SearchSchemaFeatures(BaseModel):
    """
    Feature flags for 'search_schema' RPC
    """

    supported: StrictBool = Field(
        description="Whether this RPC method is supported at all",
    )


class SetRowFiltersFeatures(BaseModel):
    """
    Feature flags for 'set_row_filters' RPC
    """

    supported: StrictBool = Field(
        description="Whether this RPC method is supported at all",
    )

    supports_conditions: StrictBool = Field(
        description="Whether AND/OR filter conditions are supported",
    )

    supported_types: List[RowFilterType] = Field(
        description="A list of supported types",
    )


class GetColumnProfilesFeatures(BaseModel):
    """
    Feature flags for 'get_column_profiles' RPC
    """

    supported: StrictBool = Field(
        description="Whether this RPC method is supported at all",
    )

    supported_types: List[ColumnProfileType] = Field(
        description="A list of supported types",
    )


class DataSelection(BaseModel):
    """
    A selection on the data grid, for copying to the clipboard or other
    actions
    """

    kind: DataSelectionKind = Field(
        description="Type of selection",
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


# ColumnValue
ColumnValue = Union[
    StrictInt,
    StrictStr,
]
# Selection in Properties
Selection = Union[
    DataSelectionSingleCell,
    DataSelectionCellRange,
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

    # Search schema by column name
    SearchSchema = "search_schema"

    # Get a rectangle of data values
    GetDataValues = "get_data_values"

    # Export data selection as a string in different formats
    ExportDataSelection = "export_data_selection"

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
    Request full schema for a table-like object
    """

    start_index: StrictInt = Field(
        description="First column schema to fetch (inclusive)",
    )

    num_columns: StrictInt = Field(
        description="Number of column schemas to fetch from start index. May extend beyond end of table",
    )


class GetSchemaRequest(BaseModel):
    """
    Request full schema for a table-like object
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
    Search schema for column names matching a passed substring
    """

    search_term: StrictStr = Field(
        description="Substring to match for (currently case insensitive)",
    )

    start_index: StrictInt = Field(
        description="Index (starting from zero) of first result to fetch",
    )

    max_results: StrictInt = Field(
        description="Maximum number of resulting column schemas to fetch from the start index",
    )


class SearchSchemaRequest(BaseModel):
    """
    Search schema for column names matching a passed substring
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
    Request a rectangular subset of data with values formatted as strings
    """

    row_start_index: StrictInt = Field(
        description="First row to fetch (inclusive)",
    )

    num_rows: StrictInt = Field(
        description="Number of rows to fetch from start index. May extend beyond end of table",
    )

    column_indices: List[StrictInt] = Field(
        description="Indices to select, which can be a sequential, sparse, or random selection",
    )

    format_options: FormatOptions = Field(
        description="Formatting options for returning data values as strings",
    )


class GetDataValuesRequest(BaseModel):
    """
    Request a rectangular subset of data with values formatted as strings
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


class ExportDataSelectionParams(BaseModel):
    """
    Export data selection as a string in different formats like CSV, TSV,
    HTML
    """

    selection: DataSelection = Field(
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


class SetRowFiltersParams(BaseModel):
    """
    Set or clear row filters on table, replacing any previous filters
    """

    filters: List[RowFilter] = Field(
        description="Zero or more filters to apply",
    )


class SetRowFiltersRequest(BaseModel):
    """
    Set or clear row filters on table, replacing any previous filters
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
    Request the current backend state (shape, filters, sort keys,
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
        ExportDataSelectionRequest,
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

FormatOptions.update_forward_refs()

TableSchema.update_forward_refs()

TableShape.update_forward_refs()

RowFilter.update_forward_refs()

BetweenFilterParams.update_forward_refs()

CompareFilterParams.update_forward_refs()

SetMembershipFilterParams.update_forward_refs()

SearchFilterParams.update_forward_refs()

ColumnProfileRequest.update_forward_refs()

ColumnProfileResult.update_forward_refs()

ColumnSummaryStats.update_forward_refs()

SummaryStatsNumber.update_forward_refs()

SummaryStatsBoolean.update_forward_refs()

SummaryStatsString.update_forward_refs()

SummaryStatsDate.update_forward_refs()

SummaryStatsDatetime.update_forward_refs()

ColumnHistogram.update_forward_refs()

ColumnFrequencyTable.update_forward_refs()

ColumnFrequencyTableItem.update_forward_refs()

ColumnQuantileValue.update_forward_refs()

ColumnSortKey.update_forward_refs()

SupportedFeatures.update_forward_refs()

SearchSchemaFeatures.update_forward_refs()

SetRowFiltersFeatures.update_forward_refs()

GetColumnProfilesFeatures.update_forward_refs()

DataSelection.update_forward_refs()

DataSelectionSingleCell.update_forward_refs()

DataSelectionCellRange.update_forward_refs()

DataSelectionRange.update_forward_refs()

DataSelectionIndices.update_forward_refs()

GetSchemaParams.update_forward_refs()

GetSchemaRequest.update_forward_refs()

SearchSchemaParams.update_forward_refs()

SearchSchemaRequest.update_forward_refs()

GetDataValuesParams.update_forward_refs()

GetDataValuesRequest.update_forward_refs()

ExportDataSelectionParams.update_forward_refs()

ExportDataSelectionRequest.update_forward_refs()

SetRowFiltersParams.update_forward_refs()

SetRowFiltersRequest.update_forward_refs()

SetSortColumnsParams.update_forward_refs()

SetSortColumnsRequest.update_forward_refs()

GetColumnProfilesParams.update_forward_refs()

GetColumnProfilesRequest.update_forward_refs()

GetStateRequest.update_forward_refs()

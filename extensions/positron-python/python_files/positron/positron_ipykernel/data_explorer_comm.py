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

from ._vendor.pydantic import BaseModel, Field


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


class SearchSchemaResult(BaseModel):
    """
    Result in Methods
    """

    matches: Optional[TableSchema] = Field(
        default=None,
        description="A schema containing matching columns up to the max_results limit",
    )

    total_num_matches: int = Field(
        description="The total number of columns matching the search term",
    )


class FilterResult(BaseModel):
    """
    The result of applying filters to a table
    """

    selected_num_rows: int = Field(
        description="Number of rows in table after applying filters",
    )

    had_errors: Optional[bool] = Field(
        default=None,
        description="Flag indicating if there were errors in evaluation",
    )


class BackendState(BaseModel):
    """
    The current backend state for the data explorer
    """

    display_name: str = Field(
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

    column_name: str = Field(
        description="Name of column as UTF-8 string",
    )

    column_index: int = Field(
        description="The position of the column within the schema",
    )

    type_name: str = Field(
        description="Exact name of data type used by underlying table",
    )

    type_display: ColumnDisplayType = Field(
        description="Canonical Positron display name of data type",
    )

    description: Optional[str] = Field(
        default=None,
        description="Column annotation / description",
    )

    children: Optional[List[ColumnSchema]] = Field(
        default=None,
        description="Schema of nested child types",
    )

    precision: Optional[int] = Field(
        default=None,
        description="Precision for decimal types",
    )

    scale: Optional[int] = Field(
        default=None,
        description="Scale for decimal types",
    )

    timezone: Optional[str] = Field(
        default=None,
        description="Time zone for timestamp with time zone",
    )

    type_size: Optional[int] = Field(
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

    row_labels: Optional[List[List[str]]] = Field(
        default=None,
        description="Zero or more arrays of row labels",
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

    num_rows: int = Field(
        description="Numbers of rows in the table",
    )

    num_columns: int = Field(
        description="Number of columns in the table",
    )


class RowFilter(BaseModel):
    """
    Specifies a table row filter based on a single column's values
    """

    filter_id: str = Field(
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

    is_valid: Optional[bool] = Field(
        default=None,
        description="Whether the filter is valid and supported by the backend, if undefined then true",
    )

    error_message: Optional[str] = Field(
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

    left_value: str = Field(
        description="The lower limit for filtering",
    )

    right_value: str = Field(
        description="The upper limit for filtering",
    )


class CompareFilterParams(BaseModel):
    """
    Parameters for the 'compare' filter type
    """

    op: CompareFilterParamsOp = Field(
        description="String representation of a binary comparison",
    )

    value: str = Field(
        description="A stringified column value for a comparison filter",
    )


class SetMembershipFilterParams(BaseModel):
    """
    Parameters for the 'set_membership' filter type
    """

    values: List[str] = Field(
        description="Array of column values for a set membership filter",
    )

    inclusive: bool = Field(
        description="Filter by including only values passed (true) or excluding (false)",
    )


class SearchFilterParams(BaseModel):
    """
    Parameters for the 'search' filter type
    """

    search_type: SearchFilterType = Field(
        description="Type of search to perform",
    )

    term: str = Field(
        description="String value/regex to search for in stringified data",
    )

    case_sensitive: bool = Field(
        description="If true, do a case-sensitive search, otherwise case-insensitive",
    )


class ColumnProfileRequest(BaseModel):
    """
    A single column profile request
    """

    column_index: int = Field(
        description="The ordinal column index to profile",
    )

    profile_type: ColumnProfileType = Field(
        description="The type of analytical column profile",
    )


class ColumnProfileResult(BaseModel):
    """
    Result of computing column profile
    """

    null_count: Optional[int] = Field(
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


class SummaryStatsNumber(BaseModel):
    """
    SummaryStatsNumber in Schemas
    """

    min_value: str = Field(
        description="Minimum value as string",
    )

    max_value: str = Field(
        description="Maximum value as string",
    )

    mean: str = Field(
        description="Average value as string",
    )

    median: str = Field(
        description="Sample median (50% value) value as string",
    )

    stdev: str = Field(
        description="Sample standard deviation as a string",
    )


class SummaryStatsBoolean(BaseModel):
    """
    SummaryStatsBoolean in Schemas
    """

    true_count: int = Field(
        description="The number of non-null true values",
    )

    false_count: int = Field(
        description="The number of non-null false values",
    )


class SummaryStatsString(BaseModel):
    """
    SummaryStatsString in Schemas
    """

    num_empty: int = Field(
        description="The number of empty / length-zero values",
    )

    num_unique: int = Field(
        description="The exact number of distinct values",
    )


class ColumnHistogram(BaseModel):
    """
    Result from a histogram profile request
    """

    bin_sizes: List[int] = Field(
        description="Absolute count of values in each histogram bin",
    )

    bin_width: float = Field(
        description="Absolute floating-point width of a histogram bin",
    )


class ColumnFrequencyTable(BaseModel):
    """
    Result from a frequency_table profile request
    """

    counts: List[ColumnFrequencyTableItem] = Field(
        description="Counts of distinct values in column",
    )

    other_count: int = Field(
        description="Number of other values not accounted for in counts. May be 0",
    )


class ColumnFrequencyTableItem(BaseModel):
    """
    Entry in a column's frequency table
    """

    value: str = Field(
        description="Stringified value",
    )

    count: int = Field(
        description="Number of occurrences of value",
    )


class ColumnQuantileValue(BaseModel):
    """
    An exact or approximate quantile value from a column
    """

    q: float = Field(
        description="Quantile number (percentile). E.g. 1 for 1%, 50 for median",
    )

    value: str = Field(
        description="Stringified quantile value",
    )

    exact: bool = Field(
        description="Whether value is exact or approximate (computed from binned data or sketches)",
    )


class ColumnSortKey(BaseModel):
    """
    Specifies a column to sort by
    """

    column_index: int = Field(
        description="Column index to sort by",
    )

    ascending: bool = Field(
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

    supported: bool = Field(
        description="Whether this RPC method is supported at all",
    )


class SetRowFiltersFeatures(BaseModel):
    """
    Feature flags for 'set_row_filters' RPC
    """

    supported: bool = Field(
        description="Whether this RPC method is supported at all",
    )

    supports_conditions: bool = Field(
        description="Whether AND/OR filter conditions are supported",
    )

    supported_types: List[RowFilterType] = Field(
        description="A list of supported types",
    )


class GetColumnProfilesFeatures(BaseModel):
    """
    Feature flags for 'get_column_profiles' RPC
    """

    supported: bool = Field(
        description="Whether this RPC method is supported at all",
    )

    supported_types: List[ColumnProfileType] = Field(
        description="A list of supported types",
    )


# ColumnValue
ColumnValue = Union[
    str,
    int,
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

    start_index: int = Field(
        description="First column schema to fetch (inclusive)",
    )

    num_columns: int = Field(
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

    search_term: str = Field(
        description="Substring to match for (currently case insensitive)",
    )

    start_index: int = Field(
        description="Index (starting from zero) of first result to fetch",
    )

    max_results: int = Field(
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

    row_start_index: int = Field(
        description="First row to fetch (inclusive)",
    )

    num_rows: int = Field(
        description="Number of rows to fetch from start index. May extend beyond end of table",
    )

    column_indices: List[int] = Field(
        description="Indices to select, which can be a sequential, sparse, or random selection",
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

FilterResult.update_forward_refs()

BackendState.update_forward_refs()

ColumnSchema.update_forward_refs()

TableData.update_forward_refs()

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

ColumnHistogram.update_forward_refs()

ColumnFrequencyTable.update_forward_refs()

ColumnFrequencyTableItem.update_forward_refs()

ColumnQuantileValue.update_forward_refs()

ColumnSortKey.update_forward_refs()

SupportedFeatures.update_forward_refs()

SearchSchemaFeatures.update_forward_refs()

SetRowFiltersFeatures.update_forward_refs()

GetColumnProfilesFeatures.update_forward_refs()

GetSchemaParams.update_forward_refs()

GetSchemaRequest.update_forward_refs()

SearchSchemaParams.update_forward_refs()

SearchSchemaRequest.update_forward_refs()

GetDataValuesParams.update_forward_refs()

GetDataValuesRequest.update_forward_refs()

SetRowFiltersParams.update_forward_refs()

SetRowFiltersRequest.update_forward_refs()

SetSortColumnsParams.update_forward_refs()

SetSortColumnsRequest.update_forward_refs()

GetColumnProfilesParams.update_forward_refs()

GetColumnProfilesRequest.update_forward_refs()

GetStateRequest.update_forward_refs()

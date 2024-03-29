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
class ColumnSchemaTypeDisplay(str, enum.Enum):
    """
    Possible values for TypeDisplay in ColumnSchema
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
class ColumnFilterFilterType(str, enum.Enum):
    """
    Possible values for FilterType in ColumnFilter
    """

    Between = "between"

    Compare = "compare"

    Isnull = "isnull"

    NotBetween = "not_between"

    Notnull = "notnull"

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
class SearchFilterParamsType(str, enum.Enum):
    """
    Possible values for Type in SearchFilterParams
    """

    Contains = "contains"

    Startswith = "startswith"

    Endswith = "endswith"

    Regex = "regex"


@enum.unique
class ColumnProfileRequestType(str, enum.Enum):
    """
    Possible values for Type in ColumnProfileRequest
    """

    NullCount = "null_count"

    SummaryStats = "summary_stats"

    Freqtable = "freqtable"

    Histogram = "histogram"


class SchemaSearchResult(BaseModel):
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


class TableData(BaseModel):
    """
    Table values formatted as strings
    """

    columns: List[List[str]] = Field(
        description="The columns of data",
    )

    row_labels: Optional[List[List[str]]] = Field(
        default=None,
        description="Zero or more arrays of row labels",
    )


class FilterResult(BaseModel):
    """
    The result of applying filters to a table
    """

    selected_num_rows: int = Field(
        description="Number of rows in table after applying filters",
    )


class TableState(BaseModel):
    """
    The current backend table state
    """

    table_shape: TableShape = Field(
        description="Provides number of rows and columns in table",
    )

    filters: List[ColumnFilter] = Field(
        description="The set of currently applied filters",
    )

    sort_keys: List[ColumnSortKey] = Field(
        description="The set of currently applied sorts",
    )


class TableShape(BaseModel):
    """
    Provides number of rows and columns in table
    """

    num_rows: int = Field(
        description="Numbers of rows in the unfiltered dataset",
    )

    num_columns: int = Field(
        description="Number of columns in the unfiltered dataset",
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

    type_display: ColumnSchemaTypeDisplay = Field(
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


class TableSchema(BaseModel):
    """
    The schema for a table-like object
    """

    columns: List[ColumnSchema] = Field(
        description="Schema for each column in the table",
    )


class ColumnFilter(BaseModel):
    """
    Specifies a table row filter based on a column's values
    """

    filter_id: str = Field(
        description="Unique identifier for this filter",
    )

    filter_type: ColumnFilterFilterType = Field(
        description="Type of filter to apply",
    )

    column_index: int = Field(
        description="Column index to apply filter to",
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

    type: SearchFilterParamsType = Field(
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

    type: ColumnProfileRequestType = Field(
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

    freqtable: Optional[ColumnFreqtable] = Field(
        default=None,
        description="Results from freqtable request",
    )


class ColumnSummaryStats(BaseModel):
    """
    ColumnSummaryStats in Schemas
    """

    min_value: str = Field(
        description="Minimum value as string",
    )

    max_value: str = Field(
        description="Maximum value as string",
    )

    mean_value: Optional[str] = Field(
        default=None,
        description="Average value as string",
    )

    median: Optional[str] = Field(
        default=None,
        description="Sample median (50% value) value as string",
    )

    q25: Optional[str] = Field(
        default=None,
        description="25th percentile value as string",
    )

    q75: Optional[str] = Field(
        default=None,
        description="75th percentile value as string",
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


class ColumnFreqtable(BaseModel):
    """
    Result from a freqtable profile request
    """

    counts: Optional[List[ColumnFreqtableItem]] = Field(
        default=None,
        description="Counts of distinct values in column",
    )

    other_count: int = Field(
        description="Number of other values not accounted for in counts. May be 0",
    )


class ColumnFreqtableItem(BaseModel):
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

    # Set column filters
    SetColumnFilters = "set_column_filters"

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
        description="Substring to match for (currently case insensitive",
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


class SetColumnFiltersParams(BaseModel):
    """
    Set or clear column filters on table, replacing any previous filters
    """

    filters: List[ColumnFilter] = Field(
        description="Zero or more filters to apply",
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
    Request the current table state (applied filters and sort columns)
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
        SetColumnFiltersRequest,
        SetSortColumnsRequest,
        GetColumnProfilesRequest,
        GetStateRequest,
    ] = Field(..., discriminator="method")


@enum.unique
class DataExplorerFrontendEvent(str, enum.Enum):
    """
    An enumeration of all the possible events that can be sent to the frontend data_explorer comm.
    """

    # Reset after a schema change
    SchemaUpdate = "schema_update"

    # Clear cache and request fresh data
    DataUpdate = "data_update"


class SchemaUpdateParams(BaseModel):
    """
    Reset after a schema change
    """

    discard_state: bool = Field(
        description="If true, the UI should discard the filter/sort state.",
    )


SchemaSearchResult.update_forward_refs()

TableData.update_forward_refs()

FilterResult.update_forward_refs()

TableState.update_forward_refs()

TableShape.update_forward_refs()

ColumnSchema.update_forward_refs()

TableSchema.update_forward_refs()

ColumnFilter.update_forward_refs()

BetweenFilterParams.update_forward_refs()

CompareFilterParams.update_forward_refs()

SetMembershipFilterParams.update_forward_refs()

SearchFilterParams.update_forward_refs()

ColumnProfileRequest.update_forward_refs()

ColumnProfileResult.update_forward_refs()

ColumnSummaryStats.update_forward_refs()

ColumnHistogram.update_forward_refs()

ColumnFreqtable.update_forward_refs()

ColumnFreqtableItem.update_forward_refs()

ColumnQuantileValue.update_forward_refs()

ColumnSortKey.update_forward_refs()

GetSchemaParams.update_forward_refs()

GetSchemaRequest.update_forward_refs()

SearchSchemaParams.update_forward_refs()

SearchSchemaRequest.update_forward_refs()

GetDataValuesParams.update_forward_refs()

GetDataValuesRequest.update_forward_refs()

SetColumnFiltersParams.update_forward_refs()

SetColumnFiltersRequest.update_forward_refs()

SetSortColumnsParams.update_forward_refs()

SetSortColumnsRequest.update_forward_refs()

GetColumnProfilesParams.update_forward_refs()

GetColumnProfilesRequest.update_forward_refs()

GetStateRequest.update_forward_refs()

SchemaUpdateParams.update_forward_refs()

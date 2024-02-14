#
# Copyright (C) 2024 Posit Software, PBC. All rights reserved.
#

#
# AUTO-GENERATED from data_tool.json; do not edit.
#

# flake8: noqa

# For forward declarations
from __future__ import annotations

import enum
from typing import Any, List, Literal, Optional, Union

from ._vendor.pydantic import BaseModel, Field

# Column values formatted as strings
ColumnFormattedData = List[str]


@enum.unique
class GetColumnProfileProfileType(str, enum.Enum):
    """
    Possible values for ProfileType in GetColumnProfile
    """

    Freqtable = "freqtable"

    Histogram = "histogram"


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

    Isnull = "isnull"

    Notnull = "notnull"

    Compare = "compare"

    SetMembership = "set_membership"

    Search = "search"


@enum.unique
class ColumnFilterCompareOp(str, enum.Enum):
    """
    Possible values for CompareOp in ColumnFilter
    """

    Eq = "="

    NotEq = "!="

    Lt = "<"

    LtEq = "<="

    Gt = ">"

    GtEq = ">="


@enum.unique
class ColumnFilterSearchType(str, enum.Enum):
    """
    Possible values for SearchType in ColumnFilter
    """

    Contains = "contains"

    Startswith = "startswith"

    Endswith = "endswith"

    Regex = "regex"


class TableSchema(BaseModel):
    """
    The schema for a table-like object
    """

    columns: List[ColumnSchema] = Field(
        description="Schema for each column in the table",
    )

    num_rows: int = Field(
        description="Numbers of rows in the unfiltered dataset",
    )

    total_num_columns: int = Field(
        description="Total number of columns in the unfiltered dataset",
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


class ProfileResult(BaseModel):
    """
    Result of computing column profile
    """

    null_count: int = Field(
        description="Number of null values in column",
    )

    min_value: Optional[str] = Field(
        default=None,
        description="Minimum value as string computed as part of histogram",
    )

    max_value: Optional[str] = Field(
        default=None,
        description="Maximum value as string computed as part of histogram",
    )

    mean_value: Optional[str] = Field(
        default=None,
        description="Average value as string computed as part of histogram",
    )

    histogram_bin_sizes: Optional[List[int]] = Field(
        default=None,
        description="Absolute count of values in each histogram bin",
    )

    histogram_bin_width: Optional[float] = Field(
        default=None,
        description="Absolute floating-point width of a histogram bin",
    )

    histogram_quantiles: Optional[List[ColumnQuantileValue]] = Field(
        default=None,
        description="Quantile values computed from histogram bins",
    )

    freqtable_counts: Optional[List[FreqtableCounts]] = Field(
        default=None,
        description="Counts of distinct values in column",
    )

    freqtable_other_count: Optional[int] = Field(
        default=None,
        description="Number of other values not accounted for in counts",
    )


class FreqtableCounts(BaseModel):
    """
    Items in FreqtableCounts
    """

    value: str = Field(
        description="Stringified value",
    )

    count: int = Field(
        description="Number of occurrences of value",
    )


class BackendState(BaseModel):
    """
    The current backend state
    """

    filters: List[ColumnFilter] = Field(
        description="The set of currently applied filters",
    )

    sort_keys: List[ColumnSortKey] = Field(
        description="The set of currently applied sorts",
    )


class ColumnSchema(BaseModel):
    """
    Schema for a column in a table
    """

    column_name: str = Field(
        description="Name of column as UTF-8 string",
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

    compare_op: Optional[ColumnFilterCompareOp] = Field(
        default=None,
        description="String representation of a binary comparison",
    )

    compare_value: Optional[str] = Field(
        default=None,
        description="A stringified column value for a comparison filter",
    )

    set_member_values: Optional[List[str]] = Field(
        default=None,
        description="Array of column values for a set membership filter",
    )

    set_member_inclusive: Optional[bool] = Field(
        default=None,
        description="Filter by including only values passed (true) or excluding (false)",
    )

    search_type: Optional[ColumnFilterSearchType] = Field(
        default=None,
        description="Type of search to perform",
    )

    search_term: Optional[str] = Field(
        default=None,
        description="String value/regex to search for in stringified data",
    )

    search_case_sensitive: Optional[bool] = Field(
        default=None,
        description="If true, do a case-sensitive search, otherwise case-insensitive",
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
class DataToolBackendRequest(str, enum.Enum):
    """
    An enumeration of all the possible requests that can be sent to the backend data_tool comm.
    """

    # Request schema
    GetSchema = "get_schema"

    # Get a rectangle of data values
    GetDataValues = "get_data_values"

    # Set column filters
    SetColumnFilters = "set_column_filters"

    # Set or clear sort-by-column(s)
    SetSortColumns = "set_sort_columns"

    # Get a column profile
    GetColumnProfile = "get_column_profile"

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

    method: Literal[DataToolBackendRequest.GetSchema] = Field(
        description="The JSON-RPC method name (get_schema)",
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

    method: Literal[DataToolBackendRequest.GetDataValues] = Field(
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

    method: Literal[DataToolBackendRequest.SetColumnFilters] = Field(
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

    method: Literal[DataToolBackendRequest.SetSortColumns] = Field(
        description="The JSON-RPC method name (set_sort_columns)",
    )

    jsonrpc: str = Field(
        default="2.0",
        description="The JSON-RPC version specifier",
    )


class GetColumnProfileParams(BaseModel):
    """
    Requests a statistical summary or data profile for a column
    """

    profile_type: GetColumnProfileProfileType = Field(
        description="The type of analytical column profile",
    )

    column_index: int = Field(
        description="Column index to compute profile for",
    )


class GetColumnProfileRequest(BaseModel):
    """
    Requests a statistical summary or data profile for a column
    """

    params: GetColumnProfileParams = Field(
        description="Parameters to the GetColumnProfile method",
    )

    method: Literal[DataToolBackendRequest.GetColumnProfile] = Field(
        description="The JSON-RPC method name (get_column_profile)",
    )

    jsonrpc: str = Field(
        default="2.0",
        description="The JSON-RPC version specifier",
    )


class GetStateRequest(BaseModel):
    """
    Request the current backend state (applied filters and sort columns)
    """

    method: Literal[DataToolBackendRequest.GetState] = Field(
        description="The JSON-RPC method name (get_state)",
    )

    jsonrpc: str = Field(
        default="2.0",
        description="The JSON-RPC version specifier",
    )


class DataToolBackendMessageContent(BaseModel):
    comm_id: str
    data: Union[
        GetSchemaRequest,
        GetDataValuesRequest,
        SetColumnFiltersRequest,
        SetSortColumnsRequest,
        GetColumnProfileRequest,
        GetStateRequest,
    ] = Field(..., discriminator="method")


TableSchema.update_forward_refs()

TableData.update_forward_refs()

FilterResult.update_forward_refs()

ProfileResult.update_forward_refs()

FreqtableCounts.update_forward_refs()

BackendState.update_forward_refs()

ColumnSchema.update_forward_refs()

ColumnFilter.update_forward_refs()

ColumnQuantileValue.update_forward_refs()

ColumnSortKey.update_forward_refs()

GetSchemaParams.update_forward_refs()

GetSchemaRequest.update_forward_refs()

GetDataValuesParams.update_forward_refs()

GetDataValuesRequest.update_forward_refs()

SetColumnFiltersParams.update_forward_refs()

SetColumnFiltersRequest.update_forward_refs()

SetSortColumnsParams.update_forward_refs()

SetSortColumnsRequest.update_forward_refs()

GetColumnProfileParams.update_forward_refs()

GetColumnProfileRequest.update_forward_refs()

GetStateRequest.update_forward_refs()

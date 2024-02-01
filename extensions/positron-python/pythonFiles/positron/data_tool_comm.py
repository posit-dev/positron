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
from dataclasses import dataclass, field
from typing import Dict, List, Union, Optional

JsonData = Union[Dict[str, "JsonData"], List["JsonData"], str, int, float, bool, None]

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


@dataclass
class TableSchema:
    """
    The schema for a table-like object
    """

    def __post_init__(self):
        """Revive parameters after initialization"""
        self.columns = [
            ColumnSchema(**d) if isinstance(d, dict) else d for d in self.columns
        ]  # type: ignore

    columns: List[ColumnSchema] = field(
        metadata={
            "description": "Schema for each column in the table",
        }
    )

    num_rows: int = field(
        metadata={
            "description": "Numbers of rows in the unfiltered dataset",
        }
    )

    total_num_columns: int = field(
        metadata={
            "description": "Total number of columns in the unfiltered dataset",
        }
    )


@dataclass
class TableData:
    """
    Table values formatted as strings
    """

    columns: List[List[str]] = field(
        metadata={
            "description": "The columns of data",
        }
    )

    row_labels: Optional[List[List[str]]] = field(
        default=None,
        metadata={
            "description": "Zero or more arrays of row labels",
            "default": None,
        },
    )


@dataclass
class FilterResult:
    """
    The result of applying filters to a table
    """

    selected_num_rows: int = field(
        metadata={
            "description": "Number of rows in table after applying filters",
        }
    )


@dataclass
class ProfileResult:
    """
    Result of computing column profile
    """

    def __post_init__(self):
        """Revive parameters after initialization"""
        if self.histogram_quantiles is not None:
            self.histogram_quantiles = [
                ColumnQuantileValue(**d) if isinstance(d, dict) else d
                for d in self.histogram_quantiles
            ]  # type: ignore

    null_count: int = field(
        metadata={
            "description": "Number of null values in column",
        }
    )

    min_value: Optional[str] = field(
        default=None,
        metadata={
            "description": "Minimum value as string computed as part of histogram",
            "default": None,
        },
    )

    max_value: Optional[str] = field(
        default=None,
        metadata={
            "description": "Maximum value as string computed as part of histogram",
            "default": None,
        },
    )

    mean_value: Optional[str] = field(
        default=None,
        metadata={
            "description": "Average value as string computed as part of histogram",
            "default": None,
        },
    )

    histogram_bin_sizes: Optional[List[int]] = field(
        default=None,
        metadata={
            "description": "Absolute count of values in each histogram bin",
            "default": None,
        },
    )

    histogram_bin_width: Optional[float] = field(
        default=None,
        metadata={
            "description": "Absolute floating-point width of a histogram bin",
            "default": None,
        },
    )

    histogram_quantiles: Optional[List[ColumnQuantileValue]] = field(
        default=None,
        metadata={
            "description": "Quantile values computed from histogram bins",
            "default": None,
        },
    )

    freqtable_counts: Optional[List[FreqtableCounts]] = field(
        default=None,
        metadata={
            "description": "Counts of distinct values in column",
            "default": None,
        },
    )

    freqtable_other_count: Optional[int] = field(
        default=None,
        metadata={
            "description": "Number of other values not accounted for in counts",
            "default": None,
        },
    )


@dataclass
class FreqtableCounts:
    """
    Items in FreqtableCounts
    """

    value: str = field(
        metadata={
            "description": "Stringified value",
        }
    )

    count: int = field(
        metadata={
            "description": "Number of occurrences of value",
        }
    )


@dataclass
class BackendState:
    """
    The current backend state
    """

    def __post_init__(self):
        """Revive parameters after initialization"""
        self.filters = [
            ColumnFilter(**d) if isinstance(d, dict) else d for d in self.filters
        ]  # type: ignore

        self.sort_keys = [
            ColumnSortKey(**d) if isinstance(d, dict) else d for d in self.sort_keys
        ]  # type: ignore

    filters: List[ColumnFilter] = field(
        metadata={
            "description": "The set of currently applied filters",
        }
    )

    sort_keys: List[ColumnSortKey] = field(
        metadata={
            "description": "The set of currently applied sorts",
        }
    )


@dataclass
class ColumnSchema:
    """
    Schema for a column in a table
    """

    def __post_init__(self):
        """Revive parameters after initialization"""
        if self.children is not None:
            self.children = [
                ColumnSchema(**d) if isinstance(d, dict) else d for d in self.children
            ]  # type: ignore

    column_name: str = field(
        metadata={
            "description": "Name of column as UTF-8 string",
        }
    )

    type_name: str = field(
        metadata={
            "description": "Exact name of data type used by underlying table",
        }
    )

    type_display: ColumnSchemaTypeDisplay = field(
        metadata={
            "description": "Canonical Positron display name of data type",
        }
    )

    description: Optional[str] = field(
        default=None,
        metadata={
            "description": "Column annotation / description",
            "default": None,
        },
    )

    children: Optional[List[ColumnSchema]] = field(
        default=None,
        metadata={
            "description": "Schema of nested child types",
            "default": None,
        },
    )

    precision: Optional[int] = field(
        default=None,
        metadata={
            "description": "Precision for decimal types",
            "default": None,
        },
    )

    scale: Optional[int] = field(
        default=None,
        metadata={
            "description": "Scale for decimal types",
            "default": None,
        },
    )

    timezone: Optional[str] = field(
        default=None,
        metadata={
            "description": "Time zone for timestamp with time zone",
            "default": None,
        },
    )

    type_size: Optional[int] = field(
        default=None,
        metadata={
            "description": "Size parameter for fixed-size types (list, binary)",
            "default": None,
        },
    )


@dataclass
class ColumnFilter:
    """
    Specifies a table row filter based on a column's values
    """

    filter_id: str = field(
        metadata={
            "description": "Unique identifier for this filter",
        }
    )

    filter_type: ColumnFilterFilterType = field(
        metadata={
            "description": "Type of filter to apply",
        }
    )

    column_index: int = field(
        metadata={
            "description": "Column index to apply filter to",
        }
    )

    compare_op: Optional[ColumnFilterCompareOp] = field(
        default=None,
        metadata={
            "description": "String representation of a binary comparison",
            "default": None,
        },
    )

    compare_value: Optional[str] = field(
        default=None,
        metadata={
            "description": "A stringified column value for a comparison filter",
            "default": None,
        },
    )

    set_member_values: Optional[List[str]] = field(
        default=None,
        metadata={
            "description": "Array of column values for a set membership filter",
            "default": None,
        },
    )

    set_member_inclusive: Optional[bool] = field(
        default=None,
        metadata={
            "description": "Filter by including only values passed (true) or excluding (false)",
            "default": None,
        },
    )

    search_type: Optional[ColumnFilterSearchType] = field(
        default=None,
        metadata={
            "description": "Type of search to perform",
            "default": None,
        },
    )

    search_term: Optional[str] = field(
        default=None,
        metadata={
            "description": "String value/regex to search for in stringified data",
            "default": None,
        },
    )

    search_case_sensitive: Optional[bool] = field(
        default=None,
        metadata={
            "description": "If true, do a case-sensitive search, otherwise case-insensitive",
            "default": None,
        },
    )


@dataclass
class ColumnQuantileValue:
    """
    An exact or approximate quantile value from a column
    """

    q: float = field(
        metadata={
            "description": "Quantile number (percentile). E.g. 1 for 1%, 50 for median",
        }
    )

    value: str = field(
        metadata={
            "description": "Stringified quantile value",
        }
    )

    exact: bool = field(
        metadata={
            "description": "Whether value is exact or approximate (computed from binned data or sketches)",
        }
    )


@dataclass
class ColumnSortKey:
    """
    Specifies a column to sort by
    """

    column_index: int = field(
        metadata={
            "description": "Column index to sort by",
        }
    )

    ascending: bool = field(
        metadata={
            "description": "Sort order, ascending (true) or descending (false)",
        }
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


@dataclass
class GetSchemaParams:
    """
    Request full schema for a table-like object
    """

    start_index: int = field(
        metadata={
            "description": "First column schema to fetch (inclusive)",
        }
    )

    num_columns: int = field(
        metadata={
            "description": "Number of column schemas to fetch from start index. May extend beyond end of table",
        }
    )


@dataclass
class GetSchemaRequest:
    """
    Request full schema for a table-like object
    """

    def __post_init__(self):
        """Revive RPC parameters after initialization"""
        if isinstance(self.params, dict):
            self.params = GetSchemaParams(**self.params)

    params: GetSchemaParams = field(metadata={"description": "Parameters to the GetSchema method"})

    method: DataToolBackendRequest = field(
        metadata={"description": "The JSON-RPC method name (get_schema)"},
        default=DataToolBackendRequest.GetSchema,
    )

    jsonrpc: str = field(
        metadata={"description": "The JSON-RPC version specifier"},
        default="2.0",
    )


@dataclass
class GetDataValuesParams:
    """
    Request a rectangular subset of data with values formatted as strings
    """

    row_start_index: int = field(
        metadata={
            "description": "First row to fetch (inclusive)",
        }
    )

    num_rows: int = field(
        metadata={
            "description": "Number of rows to fetch from start index. May extend beyond end of table",
        }
    )

    column_indices: List[int] = field(
        metadata={
            "description": "Indices to select, which can be a sequential, sparse, or random selection",
        }
    )


@dataclass
class GetDataValuesRequest:
    """
    Request a rectangular subset of data with values formatted as strings
    """

    def __post_init__(self):
        """Revive RPC parameters after initialization"""
        if isinstance(self.params, dict):
            self.params = GetDataValuesParams(**self.params)

    params: GetDataValuesParams = field(
        metadata={"description": "Parameters to the GetDataValues method"}
    )

    method: DataToolBackendRequest = field(
        metadata={"description": "The JSON-RPC method name (get_data_values)"},
        default=DataToolBackendRequest.GetDataValues,
    )

    jsonrpc: str = field(
        metadata={"description": "The JSON-RPC version specifier"},
        default="2.0",
    )


@dataclass
class SetColumnFiltersParams:
    """
    Set or clear column filters on table, replacing any previous filters
    """

    def __post_init__(self):
        """Revive parameters after initialization"""
        self.filters = [
            ColumnFilter(**d) if isinstance(d, dict) else d for d in self.filters
        ]  # type: ignore

    filters: List[ColumnFilter] = field(
        metadata={
            "description": "Zero or more filters to apply",
        }
    )


@dataclass
class SetColumnFiltersRequest:
    """
    Set or clear column filters on table, replacing any previous filters
    """

    def __post_init__(self):
        """Revive RPC parameters after initialization"""
        if isinstance(self.params, dict):
            self.params = SetColumnFiltersParams(**self.params)

    params: SetColumnFiltersParams = field(
        metadata={"description": "Parameters to the SetColumnFilters method"}
    )

    method: DataToolBackendRequest = field(
        metadata={"description": "The JSON-RPC method name (set_column_filters)"},
        default=DataToolBackendRequest.SetColumnFilters,
    )

    jsonrpc: str = field(
        metadata={"description": "The JSON-RPC version specifier"},
        default="2.0",
    )


@dataclass
class SetSortColumnsParams:
    """
    Set or clear the columns(s) to sort by, replacing any previous sort
    columns
    """

    def __post_init__(self):
        """Revive parameters after initialization"""
        self.sort_keys = [
            ColumnSortKey(**d) if isinstance(d, dict) else d for d in self.sort_keys
        ]  # type: ignore

    sort_keys: List[ColumnSortKey] = field(
        metadata={
            "description": "Pass zero or more keys to sort by. Clears any existing keys",
        }
    )


@dataclass
class SetSortColumnsRequest:
    """
    Set or clear the columns(s) to sort by, replacing any previous sort
    columns
    """

    def __post_init__(self):
        """Revive RPC parameters after initialization"""
        if isinstance(self.params, dict):
            self.params = SetSortColumnsParams(**self.params)

    params: SetSortColumnsParams = field(
        metadata={"description": "Parameters to the SetSortColumns method"}
    )

    method: DataToolBackendRequest = field(
        metadata={"description": "The JSON-RPC method name (set_sort_columns)"},
        default=DataToolBackendRequest.SetSortColumns,
    )

    jsonrpc: str = field(
        metadata={"description": "The JSON-RPC version specifier"},
        default="2.0",
    )


@dataclass
class GetColumnProfileParams:
    """
    Requests a statistical summary or data profile for a column
    """

    profile_type: GetColumnProfileProfileType = field(
        metadata={
            "description": "The type of analytical column profile",
        }
    )

    column_index: int = field(
        metadata={
            "description": "Column index to compute profile for",
        }
    )


@dataclass
class GetColumnProfileRequest:
    """
    Requests a statistical summary or data profile for a column
    """

    def __post_init__(self):
        """Revive RPC parameters after initialization"""
        if isinstance(self.params, dict):
            self.params = GetColumnProfileParams(**self.params)

    params: GetColumnProfileParams = field(
        metadata={"description": "Parameters to the GetColumnProfile method"}
    )

    method: DataToolBackendRequest = field(
        metadata={"description": "The JSON-RPC method name (get_column_profile)"},
        default=DataToolBackendRequest.GetColumnProfile,
    )

    jsonrpc: str = field(
        metadata={"description": "The JSON-RPC version specifier"},
        default="2.0",
    )


@dataclass
class GetStateRequest:
    """
    Request the current backend state (applied filters and sort columns)
    """

    method: DataToolBackendRequest = field(
        metadata={"description": "The JSON-RPC method name (get_state)"},
        default=DataToolBackendRequest.GetState,
    )

    jsonrpc: str = field(
        metadata={"description": "The JSON-RPC version specifier"},
        default="2.0",
    )

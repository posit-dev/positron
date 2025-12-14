# ---------------------------------------------------------------------------------------------
# Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ---------------------------------------------------------------------------------------------

#
# AUTO-GENERATED from data_explorer.json; do not edit.
#

"""
Possible values for SortOrder in SearchSchema
"""
@enum SearchSchemaSortOrder begin
    SearchSchemaSortOrder_Original
    SearchSchemaSortOrder_AscendingName
    SearchSchemaSortOrder_DescendingName
    SearchSchemaSortOrder_AscendingType
    SearchSchemaSortOrder_DescendingType
end

const SEARCHSCHEMASORTORDER_MAP = Dict(
    SearchSchemaSortOrder_Original => "original",
    SearchSchemaSortOrder_AscendingName => "ascending_name",
    SearchSchemaSortOrder_DescendingName => "descending_name",
    SearchSchemaSortOrder_AscendingType => "ascending_type",
    SearchSchemaSortOrder_DescendingType => "descending_type",
)

const STRING_TO_SEARCHSCHEMASORTORDER = Dict(v => k for (k, v) in SEARCHSCHEMASORTORDER_MAP)

StructTypes.StructType(::Type{SearchSchemaSortOrder}) = StructTypes.StringType()
StructTypes.construct(::Type{SearchSchemaSortOrder}, s::String) =
    STRING_TO_SEARCHSCHEMASORTORDER[s]
Base.string(x::SearchSchemaSortOrder) = SEARCHSCHEMASORTORDER_MAP[x]

"""
Possible values for ColumnDisplayType
"""
@enum ColumnDisplayType begin
    ColumnDisplayType_Boolean
    ColumnDisplayType_String
    ColumnDisplayType_Date
    ColumnDisplayType_Datetime
    ColumnDisplayType_Time
    ColumnDisplayType_Interval
    ColumnDisplayType_Object
    ColumnDisplayType_Array
    ColumnDisplayType_Struct
    ColumnDisplayType_Unknown
    ColumnDisplayType_Floating
    ColumnDisplayType_Integer
    ColumnDisplayType_Decimal
end

const COLUMNDISPLAYTYPE_MAP = Dict(
    ColumnDisplayType_Boolean => "boolean",
    ColumnDisplayType_String => "string",
    ColumnDisplayType_Date => "date",
    ColumnDisplayType_Datetime => "datetime",
    ColumnDisplayType_Time => "time",
    ColumnDisplayType_Interval => "interval",
    ColumnDisplayType_Object => "object",
    ColumnDisplayType_Array => "array",
    ColumnDisplayType_Struct => "struct",
    ColumnDisplayType_Unknown => "unknown",
    ColumnDisplayType_Floating => "floating",
    ColumnDisplayType_Integer => "integer",
    ColumnDisplayType_Decimal => "decimal",
)

const STRING_TO_COLUMNDISPLAYTYPE = Dict(v => k for (k, v) in COLUMNDISPLAYTYPE_MAP)

StructTypes.StructType(::Type{ColumnDisplayType}) = StructTypes.StringType()
StructTypes.construct(::Type{ColumnDisplayType}, s::String) = STRING_TO_COLUMNDISPLAYTYPE[s]
Base.string(x::ColumnDisplayType) = COLUMNDISPLAYTYPE_MAP[x]

"""
Possible values for Condition in RowFilter
"""
@enum RowFilterCondition begin
    RowFilterCondition_And
    RowFilterCondition_Or
end

const ROWFILTERCONDITION_MAP =
    Dict(RowFilterCondition_And => "and", RowFilterCondition_Or => "or")

const STRING_TO_ROWFILTERCONDITION = Dict(v => k for (k, v) in ROWFILTERCONDITION_MAP)

StructTypes.StructType(::Type{RowFilterCondition}) = StructTypes.StringType()
StructTypes.construct(::Type{RowFilterCondition}, s::String) =
    STRING_TO_ROWFILTERCONDITION[s]
Base.string(x::RowFilterCondition) = ROWFILTERCONDITION_MAP[x]

"""
Possible values for RowFilterType
"""
@enum RowFilterType begin
    RowFilterType_Between
    RowFilterType_Compare
    RowFilterType_IsEmpty
    RowFilterType_IsFalse
    RowFilterType_IsNull
    RowFilterType_IsTrue
    RowFilterType_NotBetween
    RowFilterType_NotEmpty
    RowFilterType_NotNull
    RowFilterType_Search
    RowFilterType_SetMembership
end

const ROWFILTERTYPE_MAP = Dict(
    RowFilterType_Between => "between",
    RowFilterType_Compare => "compare",
    RowFilterType_IsEmpty => "is_empty",
    RowFilterType_IsFalse => "is_false",
    RowFilterType_IsNull => "is_null",
    RowFilterType_IsTrue => "is_true",
    RowFilterType_NotBetween => "not_between",
    RowFilterType_NotEmpty => "not_empty",
    RowFilterType_NotNull => "not_null",
    RowFilterType_Search => "search",
    RowFilterType_SetMembership => "set_membership",
)

const STRING_TO_ROWFILTERTYPE = Dict(v => k for (k, v) in ROWFILTERTYPE_MAP)

StructTypes.StructType(::Type{RowFilterType}) = StructTypes.StringType()
StructTypes.construct(::Type{RowFilterType}, s::String) = STRING_TO_ROWFILTERTYPE[s]
Base.string(x::RowFilterType) = ROWFILTERTYPE_MAP[x]

"""
Possible values for Op in FilterComparison
"""
@enum FilterComparisonOp begin
    FilterComparisonOp_Eq
    FilterComparisonOp_NotEq
    FilterComparisonOp_Lt
    FilterComparisonOp_LtEq
    FilterComparisonOp_Gt
    FilterComparisonOp_GtEq
end

const FILTERCOMPARISONOP_MAP = Dict(
    FilterComparisonOp_Eq => "=",
    FilterComparisonOp_NotEq => "!=",
    FilterComparisonOp_Lt => "<",
    FilterComparisonOp_LtEq => "<=",
    FilterComparisonOp_Gt => ">",
    FilterComparisonOp_GtEq => ">=",
)

const STRING_TO_FILTERCOMPARISONOP = Dict(v => k for (k, v) in FILTERCOMPARISONOP_MAP)

StructTypes.StructType(::Type{FilterComparisonOp}) = StructTypes.StringType()
StructTypes.construct(::Type{FilterComparisonOp}, s::String) =
    STRING_TO_FILTERCOMPARISONOP[s]
Base.string(x::FilterComparisonOp) = FILTERCOMPARISONOP_MAP[x]

"""
Possible values for TextSearchType
"""
@enum TextSearchType begin
    TextSearchType_Contains
    TextSearchType_NotContains
    TextSearchType_StartsWith
    TextSearchType_EndsWith
    TextSearchType_RegexMatch
end

const TEXTSEARCHTYPE_MAP = Dict(
    TextSearchType_Contains => "contains",
    TextSearchType_NotContains => "not_contains",
    TextSearchType_StartsWith => "starts_with",
    TextSearchType_EndsWith => "ends_with",
    TextSearchType_RegexMatch => "regex_match",
)

const STRING_TO_TEXTSEARCHTYPE = Dict(v => k for (k, v) in TEXTSEARCHTYPE_MAP)

StructTypes.StructType(::Type{TextSearchType}) = StructTypes.StringType()
StructTypes.construct(::Type{TextSearchType}, s::String) = STRING_TO_TEXTSEARCHTYPE[s]
Base.string(x::TextSearchType) = TEXTSEARCHTYPE_MAP[x]

"""
Possible values for ColumnFilterType
"""
@enum ColumnFilterType begin
    ColumnFilterType_TextSearch
    ColumnFilterType_MatchDataTypes
end

const COLUMNFILTERTYPE_MAP = Dict(
    ColumnFilterType_TextSearch => "text_search",
    ColumnFilterType_MatchDataTypes => "match_data_types",
)

const STRING_TO_COLUMNFILTERTYPE = Dict(v => k for (k, v) in COLUMNFILTERTYPE_MAP)

StructTypes.StructType(::Type{ColumnFilterType}) = StructTypes.StringType()
StructTypes.construct(::Type{ColumnFilterType}, s::String) = STRING_TO_COLUMNFILTERTYPE[s]
Base.string(x::ColumnFilterType) = COLUMNFILTERTYPE_MAP[x]

"""
Possible values for ColumnProfileType
"""
@enum ColumnProfileType begin
    ColumnProfileType_NullCount
    ColumnProfileType_SummaryStats
    ColumnProfileType_SmallFrequencyTable
    ColumnProfileType_LargeFrequencyTable
    ColumnProfileType_SmallHistogram
    ColumnProfileType_LargeHistogram
end

const COLUMNPROFILETYPE_MAP = Dict(
    ColumnProfileType_NullCount => "null_count",
    ColumnProfileType_SummaryStats => "summary_stats",
    ColumnProfileType_SmallFrequencyTable => "small_frequency_table",
    ColumnProfileType_LargeFrequencyTable => "large_frequency_table",
    ColumnProfileType_SmallHistogram => "small_histogram",
    ColumnProfileType_LargeHistogram => "large_histogram",
)

const STRING_TO_COLUMNPROFILETYPE = Dict(v => k for (k, v) in COLUMNPROFILETYPE_MAP)

StructTypes.StructType(::Type{ColumnProfileType}) = StructTypes.StringType()
StructTypes.construct(::Type{ColumnProfileType}, s::String) = STRING_TO_COLUMNPROFILETYPE[s]
Base.string(x::ColumnProfileType) = COLUMNPROFILETYPE_MAP[x]

"""
Possible values for Method in ColumnHistogramParams
"""
@enum ColumnHistogramParamsMethod begin
    ColumnHistogramParamsMethod_Sturges
    ColumnHistogramParamsMethod_FreedmanDiaconis
    ColumnHistogramParamsMethod_Scott
    ColumnHistogramParamsMethod_Fixed
end

const COLUMNHISTOGRAMPARAMSMETHOD_MAP = Dict(
    ColumnHistogramParamsMethod_Sturges => "sturges",
    ColumnHistogramParamsMethod_FreedmanDiaconis => "freedman_diaconis",
    ColumnHistogramParamsMethod_Scott => "scott",
    ColumnHistogramParamsMethod_Fixed => "fixed",
)

const STRING_TO_COLUMNHISTOGRAMPARAMSMETHOD =
    Dict(v => k for (k, v) in COLUMNHISTOGRAMPARAMSMETHOD_MAP)

StructTypes.StructType(::Type{ColumnHistogramParamsMethod}) = StructTypes.StringType()
StructTypes.construct(::Type{ColumnHistogramParamsMethod}, s::String) =
    STRING_TO_COLUMNHISTOGRAMPARAMSMETHOD[s]
Base.string(x::ColumnHistogramParamsMethod) = COLUMNHISTOGRAMPARAMSMETHOD_MAP[x]

"""
Possible values for Kind in TableSelection
"""
@enum TableSelectionKind begin
    TableSelectionKind_SingleCell
    TableSelectionKind_CellRange
    TableSelectionKind_ColumnRange
    TableSelectionKind_RowRange
    TableSelectionKind_ColumnIndices
    TableSelectionKind_RowIndices
    TableSelectionKind_CellIndices
end

const TABLESELECTIONKIND_MAP = Dict(
    TableSelectionKind_SingleCell => "single_cell",
    TableSelectionKind_CellRange => "cell_range",
    TableSelectionKind_ColumnRange => "column_range",
    TableSelectionKind_RowRange => "row_range",
    TableSelectionKind_ColumnIndices => "column_indices",
    TableSelectionKind_RowIndices => "row_indices",
    TableSelectionKind_CellIndices => "cell_indices",
)

const STRING_TO_TABLESELECTIONKIND = Dict(v => k for (k, v) in TABLESELECTIONKIND_MAP)

StructTypes.StructType(::Type{TableSelectionKind}) = StructTypes.StringType()
StructTypes.construct(::Type{TableSelectionKind}, s::String) =
    STRING_TO_TABLESELECTIONKIND[s]
Base.string(x::TableSelectionKind) = TABLESELECTIONKIND_MAP[x]

"""
Possible values for ExportFormat
"""
@enum ExportFormat begin
    ExportFormat_Csv
    ExportFormat_Tsv
    ExportFormat_Html
end

const EXPORTFORMAT_MAP =
    Dict(ExportFormat_Csv => "csv", ExportFormat_Tsv => "tsv", ExportFormat_Html => "html")

const STRING_TO_EXPORTFORMAT = Dict(v => k for (k, v) in EXPORTFORMAT_MAP)

StructTypes.StructType(::Type{ExportFormat}) = StructTypes.StringType()
StructTypes.construct(::Type{ExportFormat}, s::String) = STRING_TO_EXPORTFORMAT[s]
Base.string(x::ExportFormat) = EXPORTFORMAT_MAP[x]

"""
Possible values for SupportStatus
"""
@enum SupportStatus begin
    SupportStatus_Unsupported
    SupportStatus_Supported
end

const SUPPORTSTATUS_MAP =
    Dict(SupportStatus_Unsupported => "unsupported", SupportStatus_Supported => "supported")

const STRING_TO_SUPPORTSTATUS = Dict(v => k for (k, v) in SUPPORTSTATUS_MAP)

StructTypes.StructType(::Type{SupportStatus}) = StructTypes.StringType()
StructTypes.construct(::Type{SupportStatus}, s::String) = STRING_TO_SUPPORTSTATUS[s]
Base.string(x::SupportStatus) = SUPPORTSTATUS_MAP[x]

"""
Result in Methods
"""
struct OpenDatasetResult
    error_message::Union{String,Nothing}
end

StructTypes.StructType(::Type{OpenDatasetResult}) = StructTypes.Struct()

"""
Result in Methods
"""
struct SearchSchemaResult
    matches::Vector{Int64}
end

StructTypes.StructType(::Type{SearchSchemaResult}) = StructTypes.Struct()

"""
Exported result
"""
struct ExportedData
    data::String
    format::ExportFormat
end

StructTypes.StructType(::Type{ExportedData}) = StructTypes.Struct()

"""
Code snippet for the data view
"""
struct ConvertedCode
    converted_code::Vector{String}
end

StructTypes.StructType(::Type{ConvertedCode}) = StructTypes.Struct()

"""
Syntax to use for code conversion
"""
struct CodeSyntaxName
    code_syntax_name::String
end

StructTypes.StructType(::Type{CodeSyntaxName}) = StructTypes.Struct()

"""
The result of applying filters to a table
"""
struct FilterResult
    selected_num_rows::Int64
    had_errors::Union{Bool,Nothing}
end

StructTypes.StructType(::Type{FilterResult}) = StructTypes.Struct()

"""
Provides number of rows and columns in a table
"""
struct TableShape
    num_rows::Int64
    num_columns::Int64
end

StructTypes.StructType(::Type{TableShape}) = StructTypes.Struct()

"""
Parameters for the 'search' filter type
"""
struct FilterTextSearch
    search_type::TextSearchType
    term::String
    case_sensitive::Bool
end

StructTypes.StructType(::Type{FilterTextSearch}) = StructTypes.Struct()

"""
Parameters for the 'match_data_types' filter type
"""
struct FilterMatchDataTypes
    display_types::Vector{ColumnDisplayType}
end

StructTypes.StructType(::Type{FilterMatchDataTypes}) = StructTypes.Struct()

# Union of column filter type-specific parameters
const ColumnFilterParams = Union{FilterTextSearch,FilterMatchDataTypes}

"""
A filter that selects a subset of columns by name, type, or other
criteria
"""
struct ColumnFilter
    filter_type::ColumnFilterType
    params::ColumnFilterParams
end

StructTypes.StructType(::Type{ColumnFilter}) = StructTypes.Struct()

"""
Schema for a column in a table
"""
struct ColumnSchema
    column_name::String
    column_label::Union{String,Nothing}
    column_index::Int64
    type_name::String
    type_display::ColumnDisplayType
    description::Union{String,Nothing}
    children::Union{Vector{ColumnSchema},Nothing}
    precision::Union{Int64,Nothing}
    scale::Union{Int64,Nothing}
    timezone::Union{String,Nothing}
    type_size::Union{Int64,Nothing}
end

StructTypes.StructType(::Type{ColumnSchema}) = StructTypes.Struct()

"""
Parameters for the 'between' and 'not_between' filter types
"""
struct FilterBetween
    left_value::String
    right_value::String
end

StructTypes.StructType(::Type{FilterBetween}) = StructTypes.Struct()

"""
Parameters for the 'compare' filter type
"""
struct FilterComparison
    op::FilterComparisonOp
    value::String
end

StructTypes.StructType(::Type{FilterComparison}) = StructTypes.Struct()

"""
Parameters for the 'set_membership' filter type
"""
struct FilterSetMembership
    values::Vector{String}
    inclusive::Bool
end

StructTypes.StructType(::Type{FilterSetMembership}) = StructTypes.Struct()

# Union of row filter parameters
const RowFilterParams =
    Union{FilterBetween,FilterComparison,FilterTextSearch,FilterSetMembership}

"""
Specifies a table row filter based on a single column's values
"""
struct RowFilter
    filter_id::String
    filter_type::RowFilterType
    column_schema::ColumnSchema
    condition::RowFilterCondition
    is_valid::Union{Bool,Nothing}
    error_message::Union{String,Nothing}
    params::Union{RowFilterParams,Nothing}
end

StructTypes.StructType(::Type{RowFilter}) = StructTypes.Struct()

"""
Specifies a column to sort by
"""
struct ColumnSortKey
    column_index::Int64
    ascending::Bool
end

StructTypes.StructType(::Type{ColumnSortKey}) = StructTypes.Struct()

"""
Support status for a column filter type
"""
struct ColumnFilterTypeSupportStatus
    column_filter_type::ColumnFilterType
    support_status::SupportStatus
end

StructTypes.StructType(::Type{ColumnFilterTypeSupportStatus}) = StructTypes.Struct()

"""
Feature flags for 'search_schema' RPC
"""
struct SearchSchemaFeatures
    support_status::SupportStatus
    supported_types::Vector{ColumnFilterTypeSupportStatus}
end

StructTypes.StructType(::Type{SearchSchemaFeatures}) = StructTypes.Struct()

"""
Feature flags for 'set_column_filters' RPC
"""
struct SetColumnFiltersFeatures
    support_status::SupportStatus
    supported_types::Vector{ColumnFilterTypeSupportStatus}
end

StructTypes.StructType(::Type{SetColumnFiltersFeatures}) = StructTypes.Struct()

"""
Support status for a row filter type
"""
struct RowFilterTypeSupportStatus
    row_filter_type::RowFilterType
    support_status::SupportStatus
end

StructTypes.StructType(::Type{RowFilterTypeSupportStatus}) = StructTypes.Struct()

"""
Feature flags for 'set_row_filters' RPC
"""
struct SetRowFiltersFeatures
    support_status::SupportStatus
    supports_conditions::SupportStatus
    supported_types::Vector{RowFilterTypeSupportStatus}
end

StructTypes.StructType(::Type{SetRowFiltersFeatures}) = StructTypes.Struct()

"""
Support status for a given column profile type
"""
struct ColumnProfileTypeSupportStatus
    profile_type::ColumnProfileType
    support_status::SupportStatus
end

StructTypes.StructType(::Type{ColumnProfileTypeSupportStatus}) = StructTypes.Struct()

"""
Feature flags for 'get_column_profiles' RPC
"""
struct GetColumnProfilesFeatures
    support_status::SupportStatus
    supported_types::Vector{ColumnProfileTypeSupportStatus}
end

StructTypes.StructType(::Type{GetColumnProfilesFeatures}) = StructTypes.Struct()

"""
Feature flags for 'set_sort_columns' RPC
"""
struct SetSortColumnsFeatures
    support_status::SupportStatus
end

StructTypes.StructType(::Type{SetSortColumnsFeatures}) = StructTypes.Struct()

"""
Feature flags for 'export_data_selction' RPC
"""
struct ExportDataSelectionFeatures
    support_status::SupportStatus
    supported_formats::Vector{ExportFormat}
end

StructTypes.StructType(::Type{ExportDataSelectionFeatures}) = StructTypes.Struct()

"""
Feature flags for convert to code RPC
"""
struct ConvertToCodeFeatures
    support_status::SupportStatus
    code_syntaxes::Union{Vector{CodeSyntaxName},Nothing}
end

StructTypes.StructType(::Type{ConvertToCodeFeatures}) = StructTypes.Struct()

"""
For each field, returns flags indicating supported features
"""
struct SupportedFeatures
    search_schema::SearchSchemaFeatures
    set_column_filters::SetColumnFiltersFeatures
    set_row_filters::SetRowFiltersFeatures
    get_column_profiles::GetColumnProfilesFeatures
    set_sort_columns::SetSortColumnsFeatures
    export_data_selection::ExportDataSelectionFeatures
    convert_to_code::ConvertToCodeFeatures
end

StructTypes.StructType(::Type{SupportedFeatures}) = StructTypes.Struct()

"""
The current backend state for the data explorer
"""
struct BackendState
    display_name::String
    table_shape::TableShape
    table_unfiltered_shape::TableShape
    has_row_labels::Bool
    column_filters::Vector{ColumnFilter}
    row_filters::Vector{RowFilter}
    sort_keys::Vector{ColumnSortKey}
    supported_features::SupportedFeatures
    connected::Union{Bool,Nothing}
    error_message::Union{String,Nothing}
end

StructTypes.StructType(::Type{BackendState}) = StructTypes.Struct()

# ColumnValue
const ColumnValue = Union{Int64,String}

"""
Table values formatted as strings
"""
struct TableData
    columns::Vector{Vector{ColumnValue}}
end

StructTypes.StructType(::Type{TableData}) = StructTypes.Struct()

"""
Formatted table row labels formatted as strings
"""
struct TableRowLabels
    row_labels::Vector{Vector{String}}
end

StructTypes.StructType(::Type{TableRowLabels}) = StructTypes.Struct()

"""
Formatting options for returning data values as strings
"""
struct FormatOptions
    large_num_digits::Int64
    small_num_digits::Int64
    max_integral_digits::Int64
    max_value_length::Int64
    thousands_sep::Union{String,Nothing}
end

StructTypes.StructType(::Type{FormatOptions}) = StructTypes.Struct()

"""
The schema for a table-like object
"""
struct TableSchema
    columns::Vector{ColumnSchema}
end

StructTypes.StructType(::Type{TableSchema}) = StructTypes.Struct()

"""
Parameters for a column histogram profile request
"""
struct ColumnHistogramParams
    method::ColumnHistogramParamsMethod
    num_bins::Int64
    quantiles::Union{Vector{Float64},Nothing}
end

StructTypes.StructType(::Type{ColumnHistogramParams}) = StructTypes.Struct()

"""
Parameters for a frequency_table profile request
"""
struct ColumnFrequencyTableParams
    limit::Int64
end

StructTypes.StructType(::Type{ColumnFrequencyTableParams}) = StructTypes.Struct()

# Extra parameters for different profile types
const ColumnProfileParams = Union{
    ColumnHistogramParams,
    ColumnHistogramParams,
    ColumnFrequencyTableParams,
    ColumnFrequencyTableParams,
}

"""
Parameters for a single column profile for a request for profiles
"""
struct ColumnProfileSpec
    profile_type::ColumnProfileType
    params::Union{ColumnProfileParams,Nothing}
end

StructTypes.StructType(::Type{ColumnProfileSpec}) = StructTypes.Struct()

"""
A single column profile request
"""
struct ColumnProfileRequest
    column_index::Int64
    profiles::Vector{ColumnProfileSpec}
end

StructTypes.StructType(::Type{ColumnProfileRequest}) = StructTypes.Struct()

"""
SummaryStatsNumber in Schemas
"""
struct SummaryStatsNumber
    min_value::Union{String,Nothing}
    max_value::Union{String,Nothing}
    mean::Union{String,Nothing}
    median::Union{String,Nothing}
    stdev::Union{String,Nothing}
end

StructTypes.StructType(::Type{SummaryStatsNumber}) = StructTypes.Struct()

"""
SummaryStatsString in Schemas
"""
struct SummaryStatsString
    num_empty::Int64
    num_unique::Int64
end

StructTypes.StructType(::Type{SummaryStatsString}) = StructTypes.Struct()

"""
SummaryStatsBoolean in Schemas
"""
struct SummaryStatsBoolean
    true_count::Int64
    false_count::Int64
end

StructTypes.StructType(::Type{SummaryStatsBoolean}) = StructTypes.Struct()

"""
SummaryStatsDate in Schemas
"""
struct SummaryStatsDate
    num_unique::Union{Int64,Nothing}
    min_date::Union{String,Nothing}
    mean_date::Union{String,Nothing}
    median_date::Union{String,Nothing}
    max_date::Union{String,Nothing}
end

StructTypes.StructType(::Type{SummaryStatsDate}) = StructTypes.Struct()

"""
SummaryStatsDatetime in Schemas
"""
struct SummaryStatsDatetime
    num_unique::Union{Int64,Nothing}
    min_date::Union{String,Nothing}
    mean_date::Union{String,Nothing}
    median_date::Union{String,Nothing}
    max_date::Union{String,Nothing}
    timezone::Union{String,Nothing}
end

StructTypes.StructType(::Type{SummaryStatsDatetime}) = StructTypes.Struct()

"""
SummaryStatsOther in Schemas
"""
struct SummaryStatsOther
    num_unique::Union{Int64,Nothing}
end

StructTypes.StructType(::Type{SummaryStatsOther}) = StructTypes.Struct()

"""
Profile result containing summary stats for a column based on the data
type
"""
struct ColumnSummaryStats
    type_display::ColumnDisplayType
    number_stats::Union{SummaryStatsNumber,Nothing}
    string_stats::Union{SummaryStatsString,Nothing}
    boolean_stats::Union{SummaryStatsBoolean,Nothing}
    date_stats::Union{SummaryStatsDate,Nothing}
    datetime_stats::Union{SummaryStatsDatetime,Nothing}
    other_stats::Union{SummaryStatsOther,Nothing}
end

StructTypes.StructType(::Type{ColumnSummaryStats}) = StructTypes.Struct()

"""
An exact or approximate quantile value from a column
"""
struct ColumnQuantileValue
    q::Float64
    value::String
    exact::Bool
end

StructTypes.StructType(::Type{ColumnQuantileValue}) = StructTypes.Struct()

"""
Result from a histogram profile request
"""
struct ColumnHistogram
    bin_edges::Vector{String}
    bin_counts::Vector{Int64}
    quantiles::Vector{ColumnQuantileValue}
end

StructTypes.StructType(::Type{ColumnHistogram}) = StructTypes.Struct()

"""
Result from a frequency_table profile request
"""
struct ColumnFrequencyTable
    values::Vector{ColumnValue}
    counts::Vector{Int64}
    other_count::Union{Int64,Nothing}
end

StructTypes.StructType(::Type{ColumnFrequencyTable}) = StructTypes.Struct()

"""
Result of computing column profile
"""
struct ColumnProfileResult
    null_count::Union{Int64,Nothing}
    summary_stats::Union{ColumnSummaryStats,Nothing}
    small_histogram::Union{ColumnHistogram,Nothing}
    large_histogram::Union{ColumnHistogram,Nothing}
    small_frequency_table::Union{ColumnFrequencyTable,Nothing}
    large_frequency_table::Union{ColumnFrequencyTable,Nothing}
end

StructTypes.StructType(::Type{ColumnProfileResult}) = StructTypes.Struct()

"""
A selection that contains a single data cell
"""
struct DataSelectionSingleCell
    row_index::Int64
    column_index::Int64
end

StructTypes.StructType(::Type{DataSelectionSingleCell}) = StructTypes.Struct()

"""
A selection that contains a rectangular range of data cells
"""
struct DataSelectionCellRange
    first_row_index::Int64
    last_row_index::Int64
    first_column_index::Int64
    last_column_index::Int64
end

StructTypes.StructType(::Type{DataSelectionCellRange}) = StructTypes.Struct()

"""
A rectangular cell selection defined by arrays of row and column
indices
"""
struct DataSelectionCellIndices
    row_indices::Vector{Int64}
    column_indices::Vector{Int64}
end

StructTypes.StructType(::Type{DataSelectionCellIndices}) = StructTypes.Struct()

"""
A contiguous selection bounded by inclusive start and end indices
"""
struct DataSelectionRange
    first_index::Int64
    last_index::Int64
end

StructTypes.StructType(::Type{DataSelectionRange}) = StructTypes.Struct()

"""
A selection defined by a sequence of indices to include
"""
struct DataSelectionIndices
    indices::Vector{Int64}
end

StructTypes.StructType(::Type{DataSelectionIndices}) = StructTypes.Struct()

# A union of selection types
const Selection = Union{
    DataSelectionSingleCell,
    DataSelectionCellRange,
    DataSelectionCellIndices,
    DataSelectionRange,
    DataSelectionIndices,
}

"""
A selection on the data grid, for copying to the clipboard or other
actions
"""
struct TableSelection
    kind::TableSelectionKind
    selection::Selection
end

StructTypes.StructType(::Type{TableSelection}) = StructTypes.Struct()

# Union of selection specifications for array_selection
const ArraySelection = Union{DataSelectionRange,DataSelectionIndices}

"""
A union of different selection types for column values
"""
struct ColumnSelection
    column_index::Int64
    spec::ArraySelection
end

StructTypes.StructType(::Type{ColumnSelection}) = StructTypes.Struct()

"""
Request to open a dataset given a URI
"""
struct DataExplorerOpenDatasetParams
    uri::String
end

StructTypes.StructType(::Type{DataExplorerOpenDatasetParams}) = StructTypes.Struct()

"""
Request subset of column schemas for a table-like object
"""
struct DataExplorerGetSchemaParams
    column_indices::Vector{Int64}
end

StructTypes.StructType(::Type{DataExplorerGetSchemaParams}) = StructTypes.Struct()

"""
Search table schema with column filters, optionally sort results
"""
struct DataExplorerSearchSchemaParams
    filters::Vector{ColumnFilter}
    sort_order::SearchSchemaSortOrder
end

StructTypes.StructType(::Type{DataExplorerSearchSchemaParams}) = StructTypes.Struct()

"""
Request data from table columns with values formatted as strings
"""
struct DataExplorerGetDataValuesParams
    columns::Vector{ColumnSelection}
    format_options::FormatOptions
end

StructTypes.StructType(::Type{DataExplorerGetDataValuesParams}) = StructTypes.Struct()

"""
Request formatted row labels from table
"""
struct DataExplorerGetRowLabelsParams
    selection::ArraySelection
    format_options::FormatOptions
end

StructTypes.StructType(::Type{DataExplorerGetRowLabelsParams}) = StructTypes.Struct()

"""
Export data selection as a string in different formats like CSV, TSV,
HTML
"""
struct DataExplorerExportDataSelectionParams
    selection::TableSelection
    format::ExportFormat
end

StructTypes.StructType(::Type{DataExplorerExportDataSelectionParams}) = StructTypes.Struct()

"""
Converts filters and sort keys as code in different syntaxes like
pandas, polars, data.table, dplyr
"""
struct DataExplorerConvertToCodeParams
    column_filters::Vector{ColumnFilter}
    row_filters::Vector{RowFilter}
    sort_keys::Vector{ColumnSortKey}
    code_syntax_name::CodeSyntaxName
end

StructTypes.StructType(::Type{DataExplorerConvertToCodeParams}) = StructTypes.Struct()

"""
Set or clear column filters on table, replacing any previous filters
"""
struct DataExplorerSetColumnFiltersParams
    filters::Vector{ColumnFilter}
end

StructTypes.StructType(::Type{DataExplorerSetColumnFiltersParams}) = StructTypes.Struct()

"""
Row filters to apply (or pass empty array to clear row filters)
"""
struct DataExplorerSetRowFiltersParams
    filters::Vector{RowFilter}
end

StructTypes.StructType(::Type{DataExplorerSetRowFiltersParams}) = StructTypes.Struct()

"""
Set or clear the columns(s) to sort by, replacing any previous sort
columns
"""
struct DataExplorerSetSortColumnsParams
    sort_keys::Vector{ColumnSortKey}
end

StructTypes.StructType(::Type{DataExplorerSetSortColumnsParams}) = StructTypes.Struct()

"""
Async request for a statistical summary or data profile for batch of
columns
"""
struct DataExplorerGetColumnProfilesParams
    callback_id::String
    profiles::Vector{ColumnProfileRequest}
    format_options::FormatOptions
end

StructTypes.StructType(::Type{DataExplorerGetColumnProfilesParams}) = StructTypes.Struct()

"""
Event: Return async result of get_column_profiles request
"""
struct DataExplorerReturnColumnProfilesParams
    callback_id::String
    profiles::Vector{ColumnProfileResult}
    error_message::Union{String,Nothing}
end

StructTypes.StructType(::Type{DataExplorerReturnColumnProfilesParams}) =
    StructTypes.Struct()

"""
Parse a backend request for the DataExplorer comm.
"""
function parse_data_explorer_request(data::Dict)
    method = get(data, "method", nothing)
    params = get(data, "params", Dict())

    if method == "open_dataset"
        return DataExplorerOpenDatasetParams(get(params, "uri", ""))
    elseif method == "get_schema"
        return DataExplorerGetSchemaParams(get(params, "column_indices", []))
    elseif method == "search_schema"
        return DataExplorerSearchSchemaParams(
            get(params, "filters", []),
            get(params, "sort_order", ""),
        )
    elseif method == "get_data_values"
        return DataExplorerGetDataValuesParams(
            get(params, "columns", []),
            get(params, "format_options", Dict()),
        )
    elseif method == "get_row_labels"
        return DataExplorerGetRowLabelsParams(
            get(params, "selection", Dict()),
            get(params, "format_options", Dict()),
        )
    elseif method == "export_data_selection"
        return DataExplorerExportDataSelectionParams(
            get(params, "selection", Dict()),
            get(params, "format", Dict()),
        )
    elseif method == "convert_to_code"
        return DataExplorerConvertToCodeParams(
            get(params, "column_filters", []),
            get(params, "row_filters", []),
            get(params, "sort_keys", []),
            get(params, "code_syntax_name", Dict()),
        )
    elseif method == "suggest_code_syntax"
        return nothing
    elseif method == "set_column_filters"
        return DataExplorerSetColumnFiltersParams(get(params, "filters", []))
    elseif method == "set_row_filters"
        return DataExplorerSetRowFiltersParams(get(params, "filters", []))
    elseif method == "set_sort_columns"
        return DataExplorerSetSortColumnsParams(get(params, "sort_keys", []))
    elseif method == "get_column_profiles"
        return DataExplorerGetColumnProfilesParams(
            get(params, "callback_id", ""),
            get(params, "profiles", []),
            get(params, "format_options", Dict()),
        )
    elseif method == "get_state"
        return nothing
    else
        error("Unknown data_explorer method: $method")
    end
end

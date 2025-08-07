/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Descriptor for backend method invocation in via extension command.
 */
export interface DataExplorerRpc {
	/**
	 * Resource locator. Must be specified for all methods except for
	 * OpenDataset (which is invoked with the uri as a parameter before
	 * other methods can be invoked).
	 */
	method: DataExplorerBackendRequest;
	uri?: string;
	params: OpenDatasetParams |
	GetSchemaParams |
	SearchSchemaParams |
	GetDataValuesParams |
	GetRowLabelsParams |
	GetColumnProfilesParams |
	SetRowFiltersParams |
	SetColumnFiltersParams |
	SetSortColumnsParams |
	GetColumnProfilesParams |
	ExportDataSelectionParams |
	{};
}

export interface DataExplorerUiEvent {
	/**
	 * Unique resource identifier for routing method calls.
	 */
	uri: string;

	/**
	 * Method name, as defined
	 */
	method: DataExplorerFrontendEvent;

	/**
	 * Data for event
	 */
	params: ReturnColumnProfilesEvent | DataUpdateEvent | SchemaUpdateEvent;
}

/**
 * Opaque backend response containing corresponding RPC result
 * or an error message in the case of failure.
 */
export interface DataExplorerResponse {
	result?: any;
	error_message?: string;
}

// AUTO-GENERATED from data_explorer.json; do not edit. Copy from
// positronDataExplorerComm.ts instead.


/**
 * Result in Methods
 */
export interface OpenDatasetResult {
	/**
	 * An error message if opening the dataset failed
	 */
	error_message?: string;

}

/**
 * Result in Methods
 */
export interface SearchSchemaResult {
	/**
	 * The column indices of the matching column indices in the indicated
	 * sort order
	 */
	matches: Array<number>;

}

/**
 * Exported result
 */
export interface ExportedData {
	/**
	 * Exported data as a string suitable for copy and paste
	 */
	data: string;

	/**
	 * The exported data format
	 */
	format: ExportFormat;

}

/**
 * Code snippet for the data view
 */
export interface ConvertedCode {
	/**
	 * Lines of code that implement filters and sort keys
	 */
	converted_code: Array<string>;

}

/**
 * Syntax to use for code conversion
 */
export interface CodeSyntaxName {
	/**
	 * The name of the code syntax, eg, pandas, polars, dplyr, etc.
	 */
	code_syntax_name: string;

}

/**
 * The result of applying filters to a table
 */
export interface FilterResult {
	/**
	 * Number of rows in table after applying filters
	 */
	selected_num_rows: number;

	/**
	 * Flag indicating if there were errors in evaluation
	 */
	had_errors?: boolean;

}

/**
 * The current backend state for the data explorer
 */
export interface BackendState {
	/**
	 * Variable name or other string to display for tab name in UI
	 */
	display_name: string;

	/**
	 * Number of rows and columns in table with row/column filters applied
	 */
	table_shape: TableShape;

	/**
	 * Number of rows and columns in table without any filters applied
	 */
	table_unfiltered_shape: TableShape;

	/**
	 * Indicates whether table has row labels or whether rows should be
	 * labeled by ordinal position
	 */
	has_row_labels: boolean;

	/**
	 * The currently applied column filters
	 */
	column_filters: Array<ColumnFilter>;

	/**
	 * The currently applied row filters
	 */
	row_filters: Array<RowFilter>;

	/**
	 * The currently applied column sort keys
	 */
	sort_keys: Array<ColumnSortKey>;

	/**
	 * The features currently supported by the backend instance
	 */
	supported_features: SupportedFeatures;

	/**
	 * Optional flag allowing backend to report that it is unable to serve
	 * requests. This parameter may change.
	 */
	connected?: boolean;

	/**
	 * Optional experimental parameter to provide an explanation when
	 * connected=false. This parameter may change.
	 */
	error_message?: string;

}

/**
 * Schema for a column in a table
 */
export interface ColumnSchema {
	/**
	 * Name of column as UTF-8 string
	 */
	column_name: string;

	/**
	 * The position of the column within the table without any column filters
	 */
	column_index: number;

	/**
	 * Exact name of data type used by underlying table
	 */
	type_name: string;

	/**
	 * Canonical Positron display name of data type
	 */
	type_display: ColumnDisplayType;

	/**
	 * Column annotation / description
	 */
	description?: string;

	/**
	 * Schema of nested child types
	 */
	children?: Array<ColumnSchema>;

	/**
	 * Precision for decimal types
	 */
	precision?: number;

	/**
	 * Scale for decimal types
	 */
	scale?: number;

	/**
	 * Time zone for timestamp with time zone
	 */
	timezone?: string;

	/**
	 * Size parameter for fixed-size types (list, binary)
	 */
	type_size?: number;

}

/**
 * Table values formatted as strings
 */
export interface TableData {
	/**
	 * The columns of data
	 */
	columns: Array<Array<ColumnValue>>;

}

/**
 * Formatted table row labels formatted as strings
 */
export interface TableRowLabels {
	/**
	 * Zero or more arrays of row labels
	 */
	row_labels: Array<Array<string>>;

}

/**
 * Formatting options for returning data values as strings
 */
export interface FormatOptions {
	/**
	 * Fixed number of decimal places to display for numbers over 1, or in
	 * scientific notation
	 */
	large_num_digits: number;

	/**
	 * Fixed number of decimal places to display for small numbers, and to
	 * determine lower threshold for switching to scientific notation
	 */
	small_num_digits: number;

	/**
	 * Maximum number of integral digits to display before switching to
	 * scientific notation
	 */
	max_integral_digits: number;

	/**
	 * Maximum size of formatted value, for truncating large strings or other
	 * large formatted values
	 */
	max_value_length: number;

	/**
	 * Thousands separator string
	 */
	thousands_sep?: string;

}

/**
 * The schema for a table-like object
 */
export interface TableSchema {
	/**
	 * Schema for each column in the table
	 */
	columns: Array<ColumnSchema>;

}

/**
 * Provides number of rows and columns in a table
 */
export interface TableShape {
	/**
	 * Numbers of rows in the table
	 */
	num_rows: number;

	/**
	 * Number of columns in the table
	 */
	num_columns: number;

}

/**
 * Specifies a table row filter based on a single column's values
 */
export interface RowFilter {
	/**
	 * Unique identifier for this filter
	 */
	filter_id: string;

	/**
	 * Type of row filter to apply
	 */
	filter_type: RowFilterType;

	/**
	 * Column to apply filter to
	 */
	column_schema: ColumnSchema;

	/**
	 * The binary condition to use to combine with preceding row filters
	 */
	condition: RowFilterCondition;

	/**
	 * Whether the filter is valid and supported by the backend, if undefined
	 * then true
	 */
	is_valid?: boolean;

	/**
	 * Optional error message when the filter is invalid
	 */
	error_message?: string;

	/**
	 * The row filter type-specific parameters
	 */
	params?: RowFilterParams;

}

/**
 * Support status for a row filter type
 */
export interface RowFilterTypeSupportStatus {
	/**
	 * Type of row filter
	 */
	row_filter_type: RowFilterType;

	/**
	 * The support status for this row filter type
	 */
	support_status: SupportStatus;

}

/**
 * Parameters for the 'between' and 'not_between' filter types
 */
export interface FilterBetween {
	/**
	 * The lower limit for filtering
	 */
	left_value: string;

	/**
	 * The upper limit for filtering
	 */
	right_value: string;

}

/**
 * Parameters for the 'compare' filter type
 */
export interface FilterComparison {
	/**
	 * String representation of a binary comparison
	 */
	op: FilterComparisonOp;

	/**
	 * A stringified column value for a comparison filter
	 */
	value: string;

}

/**
 * Parameters for the 'set_membership' filter type
 */
export interface FilterSetMembership {
	/**
	 * Array of values for a set membership filter
	 */
	values: Array<string>;

	/**
	 * Filter by including only values passed (true) or excluding (false)
	 */
	inclusive: boolean;

}

/**
 * Parameters for the 'search' filter type
 */
export interface FilterTextSearch {
	/**
	 * Type of search to perform
	 */
	search_type: TextSearchType;

	/**
	 * String value/regex to search for
	 */
	term: string;

	/**
	 * If true, do a case-sensitive search, otherwise case-insensitive
	 */
	case_sensitive: boolean;

}

/**
 * Parameters for the 'match_data_types' filter type
 */
export interface FilterMatchDataTypes {
	/**
	 * Column display types to match
	 */
	display_types: Array<ColumnDisplayType>;

}

/**
 * A filter that selects a subset of columns by name, type, or other
 * criteria
 */
export interface ColumnFilter {
	/**
	 * Type of column filter to apply
	 */
	filter_type: ColumnFilterType;

	/**
	 * Parameters for column filter
	 */
	params: ColumnFilterParams;

}

/**
 * Support status for a column filter type
 */
export interface ColumnFilterTypeSupportStatus {
	/**
	 * Type of column filter
	 */
	column_filter_type: ColumnFilterType;

	/**
	 * The support status for this column filter type
	 */
	support_status: SupportStatus;

}

/**
 * A single column profile request
 */
export interface ColumnProfileRequest {
	/**
	 * The column index (absolute, relative to unfiltered table) to profile
	 */
	column_index: number;

	/**
	 * Column profiles needed
	 */
	profiles: Array<ColumnProfileSpec>;

}

/**
 * Parameters for a single column profile for a request for profiles
 */
export interface ColumnProfileSpec {
	/**
	 * Type of column profile
	 */
	profile_type: ColumnProfileType;

	/**
	 * Extra parameters for different profile types
	 */
	params?: ColumnProfileParams;

}

/**
 * Support status for a given column profile type
 */
export interface ColumnProfileTypeSupportStatus {
	/**
	 * The type of analytical column profile
	 */
	profile_type: ColumnProfileType;

	/**
	 * The support status for this column profile type
	 */
	support_status: SupportStatus;

}

/**
 * Result of computing column profile
 */
export interface ColumnProfileResult {
	/**
	 * Result from null_count request
	 */
	null_count?: number;

	/**
	 * Results from summary_stats request
	 */
	summary_stats?: ColumnSummaryStats;

	/**
	 * Results from small histogram request
	 */
	small_histogram?: ColumnHistogram;

	/**
	 * Results from large histogram request
	 */
	large_histogram?: ColumnHistogram;

	/**
	 * Results from small frequency_table request
	 */
	small_frequency_table?: ColumnFrequencyTable;

	/**
	 * Results from large frequency_table request
	 */
	large_frequency_table?: ColumnFrequencyTable;

}

/**
 * Profile result containing summary stats for a column based on the data
 * type
 */
export interface ColumnSummaryStats {
	/**
	 * Canonical Positron display name of data type
	 */
	type_display: ColumnDisplayType;

	/**
	 * Statistics for a numeric data type
	 */
	number_stats?: SummaryStatsNumber;

	/**
	 * Statistics for a string-like data type
	 */
	string_stats?: SummaryStatsString;

	/**
	 * Statistics for a boolean data type
	 */
	boolean_stats?: SummaryStatsBoolean;

	/**
	 * Statistics for a date data type
	 */
	date_stats?: SummaryStatsDate;

	/**
	 * Statistics for a datetime data type
	 */
	datetime_stats?: SummaryStatsDatetime;

	/**
	 * Summary statistics for any other data types
	 */
	other_stats?: SummaryStatsOther;

}

/**
 * SummaryStatsNumber in Schemas
 */
export interface SummaryStatsNumber {
	/**
	 * Minimum value as string
	 */
	min_value?: string;

	/**
	 * Maximum value as string
	 */
	max_value?: string;

	/**
	 * Average value as string
	 */
	mean?: string;

	/**
	 * Sample median (50% value) value as string
	 */
	median?: string;

	/**
	 * Sample standard deviation as a string
	 */
	stdev?: string;

}

/**
 * SummaryStatsBoolean in Schemas
 */
export interface SummaryStatsBoolean {
	/**
	 * The number of non-null true values
	 */
	true_count: number;

	/**
	 * The number of non-null false values
	 */
	false_count: number;

}

/**
 * SummaryStatsOther in Schemas
 */
export interface SummaryStatsOther {
	/**
	 * The number of unique values
	 */
	num_unique?: number;

}

/**
 * SummaryStatsString in Schemas
 */
export interface SummaryStatsString {
	/**
	 * The number of empty / length-zero values
	 */
	num_empty: number;

	/**
	 * The exact number of distinct values
	 */
	num_unique: number;

}

/**
 * SummaryStatsDate in Schemas
 */
export interface SummaryStatsDate {
	/**
	 * The exact number of distinct values
	 */
	num_unique?: number;

	/**
	 * Minimum date value as string
	 */
	min_date?: string;

	/**
	 * Average date value as string
	 */
	mean_date?: string;

	/**
	 * Sample median (50% value) date value as string
	 */
	median_date?: string;

	/**
	 * Maximum date value as string
	 */
	max_date?: string;

}

/**
 * SummaryStatsDatetime in Schemas
 */
export interface SummaryStatsDatetime {
	/**
	 * The exact number of distinct values
	 */
	num_unique?: number;

	/**
	 * Minimum date value as string
	 */
	min_date?: string;

	/**
	 * Average date value as string
	 */
	mean_date?: string;

	/**
	 * Sample median (50% value) date value as string
	 */
	median_date?: string;

	/**
	 * Maximum date value as string
	 */
	max_date?: string;

	/**
	 * Time zone for timestamp with time zone
	 */
	timezone?: string;

}

/**
 * Parameters for a column histogram profile request
 */
export interface ColumnHistogramParams {
	/**
	 * Method for determining number of bins
	 */
	method: ColumnHistogramParamsMethod;

	/**
	 * Maximum number of bins in the computed histogram.
	 */
	num_bins: number;

	/**
	 * Sample quantiles (numbers between 0 and 1) to compute along with the
	 * histogram
	 */
	quantiles?: Array<number>;

}

/**
 * Result from a histogram profile request
 */
export interface ColumnHistogram {
	/**
	 * String-formatted versions of the bin edges, there are N + 1 where N is
	 * the number of bins
	 */
	bin_edges: Array<string>;

	/**
	 * Absolute count of values in each histogram bin
	 */
	bin_counts: Array<number>;

	/**
	 * Sample quantiles that were also requested
	 */
	quantiles: Array<ColumnQuantileValue>;

}

/**
 * Parameters for a frequency_table profile request
 */
export interface ColumnFrequencyTableParams {
	/**
	 * Number of most frequently-occurring values to return. The K in TopK
	 */
	limit: number;

}

/**
 * Result from a frequency_table profile request
 */
export interface ColumnFrequencyTable {
	/**
	 * The formatted top values
	 */
	values: Array<ColumnValue>;

	/**
	 * Counts of top values
	 */
	counts: Array<number>;

	/**
	 * Number of other values not accounted for in counts, excluding nulls/NA
	 * values. May be omitted
	 */
	other_count?: number;

}

/**
 * An exact or approximate quantile value from a column
 */
export interface ColumnQuantileValue {
	/**
	 * Quantile number; a number between 0 and 1
	 */
	q: number;

	/**
	 * Stringified quantile value
	 */
	value: string;

	/**
	 * Whether value is exact or approximate (computed from binned data or
	 * sketches)
	 */
	exact: boolean;

}

/**
 * Specifies a column to sort by
 */
export interface ColumnSortKey {
	/**
	 * Column index (absolute, relative to unfiltered table) to sort by
	 */
	column_index: number;

	/**
	 * Sort order, ascending (true) or descending (false)
	 */
	ascending: boolean;

}

/**
 * For each field, returns flags indicating supported features
 */
export interface SupportedFeatures {
	/**
	 * Support for 'search_schema' RPC and its features
	 */
	search_schema: SearchSchemaFeatures;

	/**
	 * Support ofr 'set_column_filters' RPC and its features
	 */
	set_column_filters: SetColumnFiltersFeatures;

	/**
	 * Support for 'set_row_filters' RPC and its features
	 */
	set_row_filters: SetRowFiltersFeatures;

	/**
	 * Support for 'get_column_profiles' RPC and its features
	 */
	get_column_profiles: GetColumnProfilesFeatures;

	/**
	 * Support for 'set_sort_columns' RPC and its features
	 */
	set_sort_columns: SetSortColumnsFeatures;

	/**
	 * Support for 'export_data_selection' RPC and its features
	 */
	export_data_selection: ExportDataSelectionFeatures;

	/**
	 * Support for 'convert_to_code' RPC and its features
	 */
	convert_to_code: ConvertToCodeFeatures;

}

/**
 * Feature flags for 'search_schema' RPC
 */
export interface SearchSchemaFeatures {
	/**
	 * The support status for this RPC method
	 */
	support_status: SupportStatus;

	/**
	 * A list of supported types
	 */
	supported_types: Array<ColumnFilterTypeSupportStatus>;

}

/**
 * Feature flags for 'set_column_filters' RPC
 */
export interface SetColumnFiltersFeatures {
	/**
	 * The support status for this RPC method
	 */
	support_status: SupportStatus;

	/**
	 * A list of supported types
	 */
	supported_types: Array<ColumnFilterTypeSupportStatus>;

}

/**
 * Feature flags for 'set_row_filters' RPC
 */
export interface SetRowFiltersFeatures {
	/**
	 * The support status for this RPC method
	 */
	support_status: SupportStatus;

	/**
	 * Whether AND/OR filter conditions are supported
	 */
	supports_conditions: SupportStatus;

	/**
	 * A list of supported types
	 */
	supported_types: Array<RowFilterTypeSupportStatus>;

}

/**
 * Feature flags for 'get_column_profiles' RPC
 */
export interface GetColumnProfilesFeatures {
	/**
	 * The support status for this RPC method
	 */
	support_status: SupportStatus;

	/**
	 * A list of supported types
	 */
	supported_types: Array<ColumnProfileTypeSupportStatus>;

}

/**
 * Feature flags for 'export_data_selction' RPC
 */
export interface ExportDataSelectionFeatures {
	/**
	 * The support status for this RPC method
	 */
	support_status: SupportStatus;

	/**
	 * Export formats supported
	 */
	supported_formats: Array<ExportFormat>;

}

/**
 * Feature flags for 'set_sort_columns' RPC
 */
export interface SetSortColumnsFeatures {
	/**
	 * The support status for this RPC method
	 */
	support_status: SupportStatus;

}

/**
 * Feature flags for convert to code RPC
 */
export interface ConvertToCodeFeatures {
	/**
	 * The support status for this RPC method
	 */
	support_status: SupportStatus;

	/**
	 * The syntaxes for converted code
	 */
	code_syntaxes?: Array<CodeSyntaxName>;

}

/**
 * A selection on the data grid, for copying to the clipboard or other
 * actions
 */
export interface TableSelection {
	/**
	 * Type of selection, all indices relative to filtered row/column indices
	 */
	kind: TableSelectionKind;

	/**
	 * A union of selection types
	 */
	selection: Selection;

}

/**
 * A selection that contains a single data cell
 */
export interface DataSelectionSingleCell {
	/**
	 * The selected row index
	 */
	row_index: number;

	/**
	 * The selected column index
	 */
	column_index: number;

}

/**
 * A selection that contains a rectangular range of data cells
 */
export interface DataSelectionCellRange {
	/**
	 * The starting selected row index (inclusive)
	 */
	first_row_index: number;

	/**
	 * The final selected row index (inclusive)
	 */
	last_row_index: number;

	/**
	 * The starting selected column index (inclusive)
	 */
	first_column_index: number;

	/**
	 * The final selected column index (inclusive)
	 */
	last_column_index: number;

}

/**
 * A contiguous selection bounded by inclusive start and end indices
 */
export interface DataSelectionRange {
	/**
	 * The starting selected index (inclusive)
	 */
	first_index: number;

	/**
	 * The final selected index (inclusive)
	 */
	last_index: number;

}

/**
 * A selection defined by a sequence of indices to include
 */
export interface DataSelectionIndices {
	/**
	 * The selected indices
	 */
	indices: Array<number>;

}

/**
 * A union of different selection types for column values
 */
export interface ColumnSelection {
	/**
	 * Column index (relative to unfiltered schema) to select data from
	 */
	column_index: number;

	/**
	 * Union of selection specifications for array_selection
	 */
	spec: ArraySelection;

}

/// ColumnValue
export type ColumnValue = number | string;

/// Union of row filter parameters
export type RowFilterParams = FilterBetween | FilterComparison | FilterTextSearch | FilterSetMembership;

/// Union of column filter type-specific parameters
export type ColumnFilterParams = FilterTextSearch | FilterMatchDataTypes;

/// Extra parameters for different profile types
export type ColumnProfileParams = ColumnHistogramParams | ColumnHistogramParams | ColumnFrequencyTableParams | ColumnFrequencyTableParams;

/// A union of selection types
export type Selection = DataSelectionSingleCell | DataSelectionCellRange | DataSelectionRange | DataSelectionIndices;

/// Union of selection specifications for array_selection
export type ArraySelection = DataSelectionRange | DataSelectionIndices;

/**
 * Possible values for SortOrder in SearchSchema
 */
export enum SearchSchemaSortOrder {
	Original = 'original',
	Ascending = 'ascending',
	Descending = 'descending'
}

/**
 * Possible values for ColumnDisplayType
 */
export enum ColumnDisplayType {
	Number = 'number',
	Boolean = 'boolean',
	String = 'string',
	Date = 'date',
	Datetime = 'datetime',
	Time = 'time',
	Interval = 'interval',
	Object = 'object',
	Array = 'array',
	Struct = 'struct',
	Unknown = 'unknown'
}

/**
 * Possible values for Condition in RowFilter
 */
export enum RowFilterCondition {
	And = 'and',
	Or = 'or'
}

/**
 * Possible values for RowFilterType
 */
export enum RowFilterType {
	Between = 'between',
	Compare = 'compare',
	IsEmpty = 'is_empty',
	IsFalse = 'is_false',
	IsNull = 'is_null',
	IsTrue = 'is_true',
	NotBetween = 'not_between',
	NotEmpty = 'not_empty',
	NotNull = 'not_null',
	Search = 'search',
	SetMembership = 'set_membership'
}

/**
 * Possible values for Op in FilterComparison
 */
export enum FilterComparisonOp {
	Eq = '=',
	NotEq = '!=',
	Lt = '<',
	LtEq = '<=',
	Gt = '>',
	GtEq = '>='
}

/**
 * Possible values for TextSearchType
 */
export enum TextSearchType {
	Contains = 'contains',
	NotContains = 'not_contains',
	StartsWith = 'starts_with',
	EndsWith = 'ends_with',
	RegexMatch = 'regex_match'
}

/**
 * Possible values for ColumnFilterType
 */
export enum ColumnFilterType {
	TextSearch = 'text_search',
	MatchDataTypes = 'match_data_types'
}

/**
 * Possible values for ColumnProfileType
 */
export enum ColumnProfileType {
	NullCount = 'null_count',
	SummaryStats = 'summary_stats',
	SmallFrequencyTable = 'small_frequency_table',
	LargeFrequencyTable = 'large_frequency_table',
	SmallHistogram = 'small_histogram',
	LargeHistogram = 'large_histogram'
}

/**
 * Possible values for Method in ColumnHistogramParams
 */
export enum ColumnHistogramParamsMethod {
	Sturges = 'sturges',
	FreedmanDiaconis = 'freedman_diaconis',
	Scott = 'scott',
	Fixed = 'fixed'
}

/**
 * Possible values for Kind in TableSelection
 */
export enum TableSelectionKind {
	SingleCell = 'single_cell',
	CellRange = 'cell_range',
	ColumnRange = 'column_range',
	RowRange = 'row_range',
	ColumnIndices = 'column_indices',
	RowIndices = 'row_indices'
}

/**
 * Possible values for ExportFormat
 */
export enum ExportFormat {
	Csv = 'csv',
	Tsv = 'tsv',
	Html = 'html'
}

/**
 * Possible values for SupportStatus
 */
export enum SupportStatus {
	Unsupported = 'unsupported',
	Supported = 'supported',
	Experimental = 'experimental'
}

/**
 * Parameters for the OpenDataset method.
 */
export interface OpenDatasetParams {
	/**
	 * The resource locator or file path
	 */
	uri: string;
}

/**
 * Parameters for the GetSchema method.
 */
export interface GetSchemaParams {
	/**
	 * The column indices (relative to the filtered/selected columns) to
	 * fetch
	 */
	column_indices: Array<number>;
}

/**
 * Parameters for the SearchSchema method.
 */
export interface SearchSchemaParams {
	/**
	 * Column filters to apply when searching, can be empty
	 */
	filters: Array<ColumnFilter>;

	/**
	 * How to sort results: original in-schema order, alphabetical ascending
	 * or descending
	 */
	sort_order: SearchSchemaSortOrder;
}

/**
 * Parameters for the GetDataValues method.
 */
export interface GetDataValuesParams {
	/**
	 * Array of column selections
	 */
	columns: Array<ColumnSelection>;

	/**
	 * Formatting options for returning data values as strings
	 */
	format_options: FormatOptions;
}

/**
 * Parameters for the GetRowLabels method.
 */
export interface GetRowLabelsParams {
	/**
	 * Selection of row labels
	 */
	selection: ArraySelection;

	/**
	 * Formatting options for returning labels as strings
	 */
	format_options: FormatOptions;
}

/**
 * Parameters for the ExportDataSelection method.
 */
export interface ExportDataSelectionParams {
	/**
	 * The data selection
	 */
	selection: TableSelection;

	/**
	 * Result string format
	 */
	format: ExportFormat;
}

/**
 * Parameters for the ConvertToCode method.
 */
export interface ConvertToCodeParams {
	/**
	 * Zero or more column filters to apply
	 */
	column_filters: Array<ColumnFilter>;

	/**
	 * Zero or more row filters to apply
	 */
	row_filters: Array<RowFilter>;

	/**
	 * Zero or more sort keys to apply
	 */
	sort_keys: Array<ColumnSortKey>;

	/**
	 * The code syntax to use for conversion
	 */
	code_syntax_name: CodeSyntaxName;
}

/**
 * Parameters for the SetColumnFilters method.
 */
export interface SetColumnFiltersParams {
	/**
	 * Column filters to apply (or pass empty array to clear column filters)
	 */
	filters: Array<ColumnFilter>;
}

/**
 * Parameters for the SetRowFilters method.
 */
export interface SetRowFiltersParams {
	/**
	 * Zero or more filters to apply
	 */
	filters: Array<RowFilter>;
}

/**
 * Parameters for the SetSortColumns method.
 */
export interface SetSortColumnsParams {
	/**
	 * Pass zero or more keys to sort by. Clears any existing keys
	 */
	sort_keys: Array<ColumnSortKey>;
}

/**
 * Parameters for the GetColumnProfiles method.
 */
export interface GetColumnProfilesParams {
	/**
	 * Async callback unique identifier
	 */
	callback_id: string;

	/**
	 * Array of requested profiles
	 */
	profiles: Array<ColumnProfileRequest>;

	/**
	 * Formatting options for returning data values as strings
	 */
	format_options: FormatOptions;
}

/**
 * Parameters for the ReturnColumnProfiles method.
 */
export interface ReturnColumnProfilesParams {
	/**
	 * Async callback unique identifier
	 */
	callback_id: string;

	/**
	 * Array of individual column profile results
	 */
	profiles: Array<ColumnProfileResult>;

	/**
	 * Optional error message if something failed to compute
	 */
	error_message?: string;
}

/**
 * Event: Request to sync after a schema change
 */
export interface SchemaUpdateEvent {
}

/**
 * Event: Clear cache and request fresh data
 */
export interface DataUpdateEvent {
}

/**
 * Event: Return async result of get_column_profiles request
 */
export interface ReturnColumnProfilesEvent {
	/**
	 * Async callback unique identifier
	 */
	callback_id: string;

	/**
	 * Array of individual column profile results
	 */
	profiles: Array<ColumnProfileResult>;

	/**
	 * Optional error message if something failed to compute
	 */
	error_message?: string;

}

export enum DataExplorerFrontendEvent {
	SchemaUpdate = 'schema_update',
	DataUpdate = 'data_update',
	ReturnColumnProfiles = 'return_column_profiles'
}

export enum DataExplorerBackendRequest {
	OpenDataset = 'open_dataset',
	GetSchema = 'get_schema',
	SearchSchema = 'search_schema',
	GetDataValues = 'get_data_values',
	GetRowLabels = 'get_row_labels',
	ExportDataSelection = 'export_data_selection',
	ConvertToCode = 'convert_to_code',
	SuggestCodeSyntax = 'suggest_code_syntax',
	SetColumnFilters = 'set_column_filters',
	SetRowFilters = 'set_row_filters',
	SetSortColumns = 'set_sort_columns',
	GetColumnProfiles = 'get_column_profiles',
	GetState = 'get_state'
}

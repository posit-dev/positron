/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

//
// AUTO-GENERATED from data_explorer.json; do not edit.
//

import { Event } from 'vs/base/common/event';
import { PositronBaseComm, PositronCommOptions } from 'vs/workbench/services/languageRuntime/common/positronBaseComm';
import { IRuntimeClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeClientInstance';

/**
 * Result in Methods
 */
export interface SearchSchemaResult {
	/**
	 * A schema containing matching columns up to the max_results limit
	 */
	matches: TableSchema;

	/**
	 * The total number of columns matching the filter
	 */
	total_num_matches: number;

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
	 * Results from histogram request
	 */
	histogram?: ColumnHistograms;

	/**
	 * Results from frequency_table request
	 */
	frequency_table?: ColumnFrequencyTable;

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
	num_unique: number;

	/**
	 * Minimum date value as string
	 */
	min_date: string;

	/**
	 * Average date value as string
	 */
	mean_date: string;

	/**
	 * Sample median (50% value) date value as string
	 */
	median_date: string;

	/**
	 * Maximum date value as string
	 */
	max_date: string;

}

/**
 * SummaryStatsDatetime in Schemas
 */
export interface SummaryStatsDatetime {
	/**
	 * The exact number of distinct values
	 */
	num_unique: number;

	/**
	 * Minimum date value as string
	 */
	min_date: string;

	/**
	 * Average date value as string
	 */
	mean_date: string;

	/**
	 * Sample median (50% value) date value as string
	 */
	median_date: string;

	/**
	 * Maximum date value as string
	 */
	max_date: string;

	/**
	 * Time zone for timestamp with time zone
	 */
	timezone?: string;

}

/**
 * Parameters to produce histograms for the summary profile
 */
export interface ColumnHistogramsParams {
	/**
	 * Parameters to build the smaller histogram
	 */
	histogram: ColumnHistogramParams;

	/**
	 * Parameters for the larger histogram used when the column is expanded
	 */
	large_histogram?: LargeHistogram;

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
	 * Number of bins in the computed histogram
	 */
	num_bins?: number;

	/**
	 * Sample quantiles (numbers between 0 and 1) to compute along with the
	 * histogram
	 */
	quantiles?: Array<number>;

}

/**
 * Result from a histogram profile request
 */
export interface ColumnHistograms {
	/**
	 * A histogram used as the small sparkline plot.
	 */
	histogram: ColumnHistogram;

	/**
	 * A larger histogram, used when the column is expanded in the summary
	 * profile
	 */
	large_histogram?: ColumnHistogram;

}

/**
 * A histogram object. Contains all necessary information to draw an
 * histogram
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
	values: Array<string>;

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
export type ColumnProfileParams = ColumnHistogramsParams | ColumnFrequencyTableParams;

/// Parameters for the larger histogram used when the column is expanded
export type LargeHistogram = number | ColumnHistogramParams;

/// A union of selection types
export type Selection = DataSelectionSingleCell | DataSelectionCellRange | DataSelectionRange | DataSelectionIndices;

/// Union of selection specifications for array_selection
export type ArraySelection = DataSelectionRange | DataSelectionIndices;

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
	FrequencyTable = 'frequency_table',
	Histogram = 'histogram'
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
 * Event: Request to sync after a schema change
 */
export interface SchemaUpdateEvent {
}

/**
 * Event: Clear cache and request fresh data
 */
export interface DataUpdateEvent {
}

export enum DataExplorerFrontendEvent {
	SchemaUpdate = 'schema_update',
	DataUpdate = 'data_update'
}

export enum DataExplorerBackendRequest {
	GetSchema = 'get_schema',
	SearchSchema = 'search_schema',
	GetDataValues = 'get_data_values',
	GetRowLabels = 'get_row_labels',
	ExportDataSelection = 'export_data_selection',
	SetColumnFilters = 'set_column_filters',
	SetRowFilters = 'set_row_filters',
	SetSortColumns = 'set_sort_columns',
	GetColumnProfiles = 'get_column_profiles',
	GetState = 'get_state'
}

export class PositronDataExplorerComm extends PositronBaseComm {
	constructor(
		instance: IRuntimeClientInstance<any, any>,
		options?: PositronCommOptions<DataExplorerBackendRequest>,
	) {
		super(instance, options);
		this.onDidSchemaUpdate = super.createEventEmitter('schema_update', []);
		this.onDidDataUpdate = super.createEventEmitter('data_update', []);
	}

	/**
	 * Request schema
	 *
	 * Request subset of column schemas for a table-like object
	 *
	 * @param columnIndices The column indices (relative to the
	 * filtered/selected columns) to fetch
	 *
	 * @returns undefined
	 */
	getSchema(columnIndices: Array<number>): Promise<TableSchema> {
		return super.performRpc('get_schema', ['column_indices'], [columnIndices]);
	}

	/**
	 * Search full, unfiltered table schema with column filters
	 *
	 * Search full, unfiltered table schema for column names matching one or
	 * more column filters
	 *
	 * @param filters Column filters to apply when searching
	 * @param startIndex Index (starting from zero) of first result to fetch
	 * (for paging)
	 * @param maxResults Maximum number of resulting column schemas to fetch
	 * from the start index
	 *
	 * @returns undefined
	 */
	searchSchema(filters: Array<ColumnFilter>, startIndex: number, maxResults: number): Promise<SearchSchemaResult> {
		return super.performRpc('search_schema', ['filters', 'start_index', 'max_results'], [filters, startIndex, maxResults]);
	}

	/**
	 * Request formatted values from table columns
	 *
	 * Request data from table columns with values formatted as strings
	 *
	 * @param columns Array of column selections
	 * @param formatOptions Formatting options for returning data values as
	 * strings
	 *
	 * @returns Requested values formatted as strings
	 */
	getDataValues(columns: Array<ColumnSelection>, formatOptions: FormatOptions): Promise<TableData> {
		return super.performRpc('get_data_values', ['columns', 'format_options'], [columns, formatOptions]);
	}

	/**
	 * Request formatted row labels from table
	 *
	 * Request formatted row labels from table
	 *
	 * @param selection Selection of row labels
	 * @param formatOptions Formatting options for returning labels as
	 * strings
	 *
	 * @returns Requested formatted row labels
	 */
	getRowLabels(selection: ArraySelection, formatOptions: FormatOptions): Promise<TableRowLabels> {
		return super.performRpc('get_row_labels', ['selection', 'format_options'], [selection, formatOptions]);
	}

	/**
	 * Export data selection as a string in different formats
	 *
	 * Export data selection as a string in different formats like CSV, TSV,
	 * HTML
	 *
	 * @param selection The data selection
	 * @param format Result string format
	 *
	 * @returns Exported result
	 */
	exportDataSelection(selection: TableSelection, format: ExportFormat): Promise<ExportedData> {
		return super.performRpc('export_data_selection', ['selection', 'format'], [selection, format]);
	}

	/**
	 * Set column filters to select subset of table columns
	 *
	 * Set or clear column filters on table, replacing any previous filters
	 *
	 * @param filters Column filters to apply (or pass empty array to clear
	 * column filters)
	 *
	 */
	setColumnFilters(filters: Array<ColumnFilter>): Promise<void> {
		return super.performRpc('set_column_filters', ['filters'], [filters]);
	}

	/**
	 * Set row filters based on column values
	 *
	 * Row filters to apply (or pass empty array to clear row filters)
	 *
	 * @param filters Zero or more filters to apply
	 *
	 * @returns The result of applying filters to a table
	 */
	setRowFilters(filters: Array<RowFilter>): Promise<FilterResult> {
		return super.performRpc('set_row_filters', ['filters'], [filters]);
	}

	/**
	 * Set or clear sort-by-column(s)
	 *
	 * Set or clear the columns(s) to sort by, replacing any previous sort
	 * columns
	 *
	 * @param sortKeys Pass zero or more keys to sort by. Clears any existing
	 * keys
	 *
	 */
	setSortColumns(sortKeys: Array<ColumnSortKey>): Promise<void> {
		return super.performRpc('set_sort_columns', ['sort_keys'], [sortKeys]);
	}

	/**
	 * Request a batch of column profiles
	 *
	 * Requests a statistical summary or data profile for batch of columns
	 *
	 * @param profiles Array of requested profiles
	 * @param formatOptions Formatting options for returning data values as
	 * strings
	 *
	 * @returns undefined
	 */
	getColumnProfiles(profiles: Array<ColumnProfileRequest>, formatOptions: FormatOptions): Promise<Array<ColumnProfileResult>> {
		return super.performRpc('get_column_profiles', ['profiles', 'format_options'], [profiles, formatOptions]);
	}

	/**
	 * Get the state
	 *
	 * Request the current backend state (table metadata, explorer state, and
	 * features)
	 *
	 *
	 * @returns The current backend state for the data explorer
	 */
	getState(): Promise<BackendState> {
		return super.performRpc('get_state', [], []);
	}


	/**
	 * Request to sync after a schema change
	 *
	 * Notify the data explorer to do a state sync after a schema change.
	 */
	onDidSchemaUpdate: Event<SchemaUpdateEvent>;
	/**
	 * Clear cache and request fresh data
	 *
	 * Triggered when there is any data change detected, clearing cache data
	 * and triggering a refresh/redraw.
	 */
	onDidDataUpdate: Event<DataUpdateEvent>;
}


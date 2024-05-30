/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
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
	matches?: TableSchema;

	/**
	 * The total number of columns matching the search term
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
	 * Number of rows and columns in table with filters applied
	 */
	table_shape: TableShape;

	/**
	 * Number of rows and columns in table without any filters applied
	 */
	table_unfiltered_shape: TableShape;

	/**
	 * The set of currently applied row filters
	 */
	row_filters: Array<RowFilter>;

	/**
	 * The set of currently applied sorts
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
	 * The position of the column within the schema
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

	/**
	 * Zero or more arrays of row labels
	 */
	row_labels?: Array<Array<string>>;

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
	 * Parameters for the 'between' and 'not_between' filter types
	 */
	between_params?: BetweenFilterParams;

	/**
	 * Parameters for the 'compare' filter type
	 */
	compare_params?: CompareFilterParams;

	/**
	 * Parameters for the 'search' filter type
	 */
	search_params?: SearchFilterParams;

	/**
	 * Parameters for the 'set_membership' filter type
	 */
	set_membership_params?: SetMembershipFilterParams;

}

/**
 * Parameters for the 'between' and 'not_between' filter types
 */
export interface BetweenFilterParams {
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
export interface CompareFilterParams {
	/**
	 * String representation of a binary comparison
	 */
	op: CompareFilterParamsOp;

	/**
	 * A stringified column value for a comparison filter
	 */
	value: string;

}

/**
 * Parameters for the 'set_membership' filter type
 */
export interface SetMembershipFilterParams {
	/**
	 * Array of column values for a set membership filter
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
export interface SearchFilterParams {
	/**
	 * Type of search to perform
	 */
	search_type: SearchFilterType;

	/**
	 * String value/regex to search for in stringified data
	 */
	term: string;

	/**
	 * If true, do a case-sensitive search, otherwise case-insensitive
	 */
	case_sensitive: boolean;

}

/**
 * A single column profile request
 */
export interface ColumnProfileRequest {
	/**
	 * The ordinal column index to profile
	 */
	column_index: number;

	/**
	 * The type of analytical column profile
	 */
	profile_type: ColumnProfileType;

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
	 * Results from summary_stats request
	 */
	histogram?: ColumnHistogram;

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

}

/**
 * SummaryStatsNumber in Schemas
 */
export interface SummaryStatsNumber {
	/**
	 * Minimum value as string
	 */
	min_value: string;

	/**
	 * Maximum value as string
	 */
	max_value: string;

	/**
	 * Average value as string
	 */
	mean: string;

	/**
	 * Sample median (50% value) value as string
	 */
	median: string;

	/**
	 * Sample standard deviation as a string
	 */
	stdev: string;

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
 * Result from a histogram profile request
 */
export interface ColumnHistogram {
	/**
	 * Absolute count of values in each histogram bin
	 */
	bin_sizes: Array<number>;

	/**
	 * Absolute floating-point width of a histogram bin
	 */
	bin_width: number;

}

/**
 * Result from a frequency_table profile request
 */
export interface ColumnFrequencyTable {
	/**
	 * Counts of distinct values in column
	 */
	counts: Array<ColumnFrequencyTableItem>;

	/**
	 * Number of other values not accounted for in counts. May be 0
	 */
	other_count: number;

}

/**
 * Entry in a column's frequency table
 */
export interface ColumnFrequencyTableItem {
	/**
	 * Stringified value
	 */
	value: string;

	/**
	 * Number of occurrences of value
	 */
	count: number;

}

/**
 * An exact or approximate quantile value from a column
 */
export interface ColumnQuantileValue {
	/**
	 * Quantile number (percentile). E.g. 1 for 1%, 50 for median
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
	 * Column index to sort by
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
	 * Support for 'set_row_filters' RPC and its features
	 */
	set_row_filters: SetRowFiltersFeatures;

	/**
	 * Support for 'get_column_profiles' RPC and its features
	 */
	get_column_profiles: GetColumnProfilesFeatures;

}

/**
 * Feature flags for 'search_schema' RPC
 */
export interface SearchSchemaFeatures {
	/**
	 * Whether this RPC method is supported at all
	 */
	supported: boolean;

}

/**
 * Feature flags for 'set_row_filters' RPC
 */
export interface SetRowFiltersFeatures {
	/**
	 * Whether this RPC method is supported at all
	 */
	supported: boolean;

	/**
	 * Whether AND/OR filter conditions are supported
	 */
	supports_conditions: boolean;

	/**
	 * A list of supported types
	 */
	supported_types: Array<RowFilterType>;

}

/**
 * Feature flags for 'get_column_profiles' RPC
 */
export interface GetColumnProfilesFeatures {
	/**
	 * Whether this RPC method is supported at all
	 */
	supported: boolean;

	/**
	 * A list of supported types
	 */
	supported_types: Array<ColumnProfileType>;

}

/**
 * A selection on the data grid, for copying to the clipboard or other
 * actions
 */
export interface DataSelection {
	/**
	 * Type of selection
	 */
	kind: DataSelectionKind;

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

/// ColumnValue
export type ColumnValue = number | string;

/// Selection in Properties
export type Selection = DataSelectionSingleCell | DataSelectionCellRange | DataSelectionRange | DataSelectionIndices;

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
 * Possible values for Op in CompareFilterParams
 */
export enum CompareFilterParamsOp {
	Eq = '=',
	NotEq = '!=',
	Lt = '<',
	LtEq = '<=',
	Gt = '>',
	GtEq = '>='
}

/**
 * Possible values for SearchFilterType
 */
export enum SearchFilterType {
	Contains = 'contains',
	StartsWith = 'starts_with',
	EndsWith = 'ends_with',
	RegexMatch = 'regex_match'
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
 * Possible values for Kind in DataSelection
 */
export enum DataSelectionKind {
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
	 * Request full schema for a table-like object
	 *
	 * @param startIndex First column schema to fetch (inclusive)
	 * @param numColumns Number of column schemas to fetch from start index.
	 * May extend beyond end of table
	 *
	 * @returns undefined
	 */
	getSchema(startIndex: number, numColumns: number): Promise<TableSchema> {
		return super.performRpc('get_schema', ['start_index', 'num_columns'], [startIndex, numColumns]);
	}

	/**
	 * Search schema by column name
	 *
	 * Search schema for column names matching a passed substring
	 *
	 * @param searchTerm Substring to match for (currently case insensitive)
	 * @param startIndex Index (starting from zero) of first result to fetch
	 * @param maxResults Maximum number of resulting column schemas to fetch
	 * from the start index
	 *
	 * @returns undefined
	 */
	searchSchema(searchTerm: string, startIndex: number, maxResults: number): Promise<SearchSchemaResult> {
		return super.performRpc('search_schema', ['search_term', 'start_index', 'max_results'], [searchTerm, startIndex, maxResults]);
	}

	/**
	 * Get a rectangle of data values
	 *
	 * Request a rectangular subset of data with values formatted as strings
	 *
	 * @param rowStartIndex First row to fetch (inclusive)
	 * @param numRows Number of rows to fetch from start index. May extend
	 * beyond end of table
	 * @param columnIndices Indices to select, which can be a sequential,
	 * sparse, or random selection
	 * @param formatOptions Formatting options for returning data values as
	 * strings
	 *
	 * @returns Table values formatted as strings
	 */
	getDataValues(rowStartIndex: number, numRows: number, columnIndices: Array<number>, formatOptions: FormatOptions): Promise<TableData> {
		return super.performRpc('get_data_values', ['row_start_index', 'num_rows', 'column_indices', 'format_options'], [rowStartIndex, numRows, columnIndices, formatOptions]);
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
	exportDataSelection(selection: DataSelection, format: ExportFormat): Promise<ExportedData> {
		return super.performRpc('export_data_selection', ['selection', 'format'], [selection, format]);
	}

	/**
	 * Set row filters based on column values
	 *
	 * Set or clear row filters on table, replacing any previous filters
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
	 * Request the current backend state (shape, filters, sort keys,
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


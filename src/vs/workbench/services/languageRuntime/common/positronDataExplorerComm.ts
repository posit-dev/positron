/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

//
// AUTO-GENERATED from data_explorer.json; do not edit.
//

import { Event } from 'vs/base/common/event';
import { PositronBaseComm } from 'vs/workbench/services/languageRuntime/common/positronBaseComm';
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
 * Table values formatted as strings
 */
export interface TableData {
	/**
	 * The columns of data
	 */
	columns: Array<Array<string>>;

	/**
	 * Zero or more arrays of row labels
	 */
	row_labels?: Array<Array<string>>;

}

/**
 * The result of applying filters to a table
 */
export interface FilterResult {
	/**
	 * Number of rows in table after applying filters
	 */
	selected_num_rows: number;

}

/**
 * The current backend table state
 */
export interface TableState {
	/**
	 * Provides number of rows and columns in table
	 */
	table_shape: TableShape;

	/**
	 * The set of currently applied row filters
	 */
	row_filters?: Array<RowFilter>;

	/**
	 * The set of currently applied sorts
	 */
	sort_keys: Array<ColumnSortKey>;

}

/**
 * Provides number of rows and columns in table
 */
export interface TableShape {
	/**
	 * Numbers of rows in the unfiltered dataset
	 */
	num_rows: number;

	/**
	 * Number of columns in the unfiltered dataset
	 */
	num_columns: number;

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
	type_display: ColumnSchemaTypeDisplay;

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
 * The schema for a table-like object
 */
export interface TableSchema {
	/**
	 * Schema for each column in the table
	 */
	columns: Array<ColumnSchema>;

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
	 * Type of filter to apply
	 */
	filter_type: RowFilterFilterType;

	/**
	 * Column index to apply filter to
	 */
	column_index: number;

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
	type: SearchFilterParamsType;

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
	type: ColumnProfileRequestType;

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
 * ColumnSummaryStats in Schemas
 */
export interface ColumnSummaryStats {
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
	mean_value?: string;

	/**
	 * Sample median (50% value) value as string
	 */
	median?: string;

	/**
	 * 25th percentile value as string
	 */
	q25?: string;

	/**
	 * 75th percentile value as string
	 */
	q75?: string;

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
 * Possible values for TypeDisplay in ColumnSchema
 */
export enum ColumnSchemaTypeDisplay {
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
 * Possible values for FilterType in RowFilter
 */
export enum RowFilterFilterType {
	Between = 'between',
	Compare = 'compare',
	IsNull = 'is_null',
	NotBetween = 'not_between',
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
 * Possible values for Type in SearchFilterParams
 */
export enum SearchFilterParamsType {
	Contains = 'contains',
	Startswith = 'startswith',
	Endswith = 'endswith',
	Regex = 'regex'
}

/**
 * Possible values for Type in ColumnProfileRequest
 */
export enum ColumnProfileRequestType {
	NullCount = 'null_count',
	SummaryStats = 'summary_stats',
	FrequencyTable = 'frequency_table',
	Histogram = 'histogram'
}

/**
 * Event: Reset after a schema change
 */
export interface SchemaUpdateEvent {
	/**
	 * If true, the UI should discard the filter/sort state.
	 */
	discard_state: boolean;

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

export class PositronDataExplorerComm extends PositronBaseComm {
	constructor(instance: IRuntimeClientInstance<any, any>) {
		super(instance);
		this.onDidSchemaUpdate = super.createEventEmitter('schema_update', ['discard_state']);
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
	 * @param searchTerm Substring to match for (currently case insensitive
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
	 *
	 * @returns Table values formatted as strings
	 */
	getDataValues(rowStartIndex: number, numRows: number, columnIndices: Array<number>): Promise<TableData> {
		return super.performRpc('get_data_values', ['row_start_index', 'num_rows', 'column_indices'], [rowStartIndex, numRows, columnIndices]);
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
	 *
	 * @returns undefined
	 */
	getColumnProfiles(profiles: Array<ColumnProfileRequest>): Promise<Array<ColumnProfileResult>> {
		return super.performRpc('get_column_profiles', ['profiles'], [profiles]);
	}

	/**
	 * Get the state
	 *
	 * Request the current table state (applied filters and sort columns)
	 *
	 *
	 * @returns The current backend table state
	 */
	getState(): Promise<TableState> {
		return super.performRpc('get_state', [], []);
	}


	/**
	 * Reset after a schema change
	 *
	 * Fully reset and redraw the data explorer after a schema change.
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


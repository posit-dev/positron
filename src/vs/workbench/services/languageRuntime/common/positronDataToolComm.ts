/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

//
// AUTO-GENERATED from data_tool.json; do not edit.
//

import { PositronBaseComm } from 'vs/workbench/services/languageRuntime/common/positronBaseComm';
import { IRuntimeClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeClientInstance';

/**
 * The schema for a table-like object
 */
export interface TableSchema {
	/**
	 * Schema for each column in the table
	 */
	columns: Array<ColumnSchema>;

	/**
	 * Numbers of rows in the unfiltered dataset
	 */
	num_rows: number;

}

/**
 * Table values formatted as strings
 */
export interface TableData {
	/**
	 * The columns of data
	 */
	columns: Array<ColumnFormattedData>;

	/**
	 * Zero or more arrays of row labels
	 */
	row_labels?: Array<ColumnFormattedData>;

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
 * Result of computing column profile
 */
export interface ProfileResult {
	/**
	 * Number of null values in column
	 */
	null_count: number;

	/**
	 * Minimum value as string computed as part of histogram
	 */
	min_value?: string;

	/**
	 * Maximum value as string computed as part of histogram
	 */
	max_value?: string;

	/**
	 * Average value as string computed as part of histogram
	 */
	mean_value?: string;

	/**
	 * Absolute count of values in each histogram bin
	 */
	histogram_bin_sizes?: Array<number>;

	/**
	 * Absolute floating-point width of a histogram bin
	 */
	histogram_bin_width?: number;

	/**
	 * Quantile values computed from histogram bins
	 */
	histogram_quantiles?: Array<ColumnQuantileValue>;

	/**
	 * Counts of distinct values in column
	 */
	freqtable_counts?: Array<FreqtableCounts>;

	/**
	 * Number of other values not accounted for in counts
	 */
	freqtable_other_count?: number;

}

/**
 * Items in FreqtableCounts
 */
export interface FreqtableCounts {
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
 * The current backend state
 */
export interface BackendState {
	/**
	 * The set of currently applied filters
	 */
	filters: Array<ColumnFilter>;

	/**
	 * The set of currently applied sorts
	 */
	sort_keys: Array<ColumnSortKey>;

}

/**
 * Schema for a column in a table
 */
export interface ColumnSchema {
	/**
	 * Name of column as UTF-8 string
	 */
	name: string;

	/**
	 * Canonical name of data type class
	 */
	type_name: string;

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
 * Specifies a table row filter based on a column's values
 */
export interface ColumnFilter {
	/**
	 * Unique identifier for this filter
	 */
	filter_id: string;

	/**
	 * Type of filter to apply
	 */
	filter_type: ColumnFilterFilterType;

	/**
	 * Column name to compute profile for
	 */
	column: string;

	/**
	 * String representation of a binary comparison
	 */
	compare_op?: ColumnFilterCompareOp;

	/**
	 * A stringified column value for a comparison filter
	 */
	compare_value?: string;

	/**
	 * Array of column values for a set membership filter
	 */
	set_member_values?: Array<string>;

	/**
	 * Filter by including only values passed (true) or excluding (false)
	 */
	set_member_inclusive?: boolean;

	/**
	 * Type of search to perform
	 */
	search_type?: ColumnFilterSearchType;

	/**
	 * String value/regex to search for in stringified data
	 */
	search_term?: string;

	/**
	 * If true, do a case-sensitive search, otherwise case-insensitive
	 */
	search_case_sensitive?: boolean;

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
	 * Column name to sort by
	 */
	column: string;

	/**
	 * Sort order, ascending (true) or descending (false)
	 */
	ascending: boolean;

}

/**
 * Possible values for ProfileType in GetColumnProfile
 */
export enum GetColumnProfileProfileType {
	Freqtable = 'freqtable',
	Histogram = 'histogram'
}

/**
 * Possible values for FilterType in ColumnFilter
 */
export enum ColumnFilterFilterType {
	Isnull = 'isnull',
	Notnull = 'notnull',
	Compare = 'compare',
	SetMembership = 'set_membership',
	Search = 'search'
}

/**
 * Possible values for CompareOp in ColumnFilter
 */
export enum ColumnFilterCompareOp {
	EqEq = '==',
	NotEq = '!=',
	Lt = '<',
	LtEq = '<=',
	Gt = '>',
	GtEq = '>='
}

/**
 * Possible values for SearchType in ColumnFilter
 */
export enum ColumnFilterSearchType {
	Contains = 'contains',
	Startswith = 'startswith',
	Endswith = 'endswith',
	Regex = 'regex'
}

/**
 * Column values formatted as strings
 */
export type ColumnFormattedData = Array<string>;

export class PositronDataToolComm extends PositronBaseComm {
	constructor(instance: IRuntimeClientInstance<any, any>) {
		super(instance);
	}

	/**
	 * Request schema
	 *
	 * Request full schema for a table-like object
	 *
	 *
	 * @returns The schema for a table-like object
	 */
	getSchema(): Promise<TableSchema> {
		return super.performRpc('get_schema', [], []);
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
	 * Set column filters
	 *
	 * Set or clear column filters on table, replacing any previous filters
	 *
	 * @param filters Zero or more filters to apply
	 *
	 * @returns The result of applying filters to a table
	 */
	setColumnFilters(filters: Array<ColumnFilter>): Promise<FilterResult> {
		return super.performRpc('set_column_filters', ['filters'], [filters]);
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
	 * Get a column profile
	 *
	 * Requests a statistical summary or data profile for a column
	 *
	 * @param profileId Unique identifier for the requested profile
	 * @param profileType The type of analytical column profile
	 * @param column Column name to compute profile for
	 *
	 * @returns Result of computing column profile
	 */
	getColumnProfile(profileId: string, profileType: GetColumnProfileProfileType, column: string): Promise<ProfileResult> {
		return super.performRpc('get_column_profile', ['profile_id', 'profile_type', 'column'], [profileId, profileType, column]);
	}

	/**
	 * Get the state
	 *
	 * Request the current backend state (applied filters and sort columns)
	 *
	 *
	 * @returns The current backend state
	 */
	getState(): Promise<BackendState> {
		return super.performRpc('get_state', [], []);
	}

}


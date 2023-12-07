/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * This module defines the interfaces used for communications between the
 * new Positron data viewer and the backend host.
 */

/**
 * Type of data tool message.
 *
 * TODO: initial_data (from data-viewer.d.ts)?
 */
export type DataToolMessageType = 'ready' |
	'schema_request' | 'schema_response' |
	'data_request' | 'data_response' |
	'filter_request' | 'filter_response' |
	'sort_request' | 'sort_response' |
	'profile_request' | 'profile_response' |
	'state_request' | 'state_response';

export interface DataToolMessage {
	msg_type: DataToolMessageType;
}

/**
 * Request the schema (column names, types, etc.) and other table metadata
 * for the active dataset.
 */
export interface DataToolSchemaRequest extends DataToolMessage { }

export interface DataToolSchemaResponse extends DataToolMessage {
	columns: Array<DataToolColumnSchema>;

	/**
	 * TODO: representation for pandas's non-numeric column names
	 * (could be integers, dates, etc.)
	 */

	/**
	 * Numbers of rows in the unfiltered dataset.
	 */
	num_rows: number;
}

export interface DataToolColumnSchema {
	/**
	 * Name of column. UTF-8 format.
	 */
	name: string;

	/**
	 * The base type class. Nested types are found in the `children` member.
	 *
	 * TODO: where is the canonical reference for the types found here?
	 *
	 */
	type_name: string;

	/**
	 * Column annotation / description.
	 */
	description: string;

	/**
	 * Schema of nested child types (e.g. struct fields or array types)
	 */
	children?: Array<DataToolColumnSchema>;

	/**
	 * TODO: handling of additional type parameters
	 * - Decimal precision and scale
	 * - Fixed size binary / list size parameter
	 * - Time zone (for timestamp with time zone)
	 */
	precision?: number;
	scale?: number;
	timezone?: string;
}

/**
 * Request a rectangle of data from the dataset for display in the UI
 * viewport. Backends are responsible for stringifying values for
 * display.
 */
export interface DataToolDataRequest extends DataToolMessage {
	row_range: [number, number];

	/**
	 * Select a set range of columns. Either an inclusive range of columns
	 * or a collection of any column indices.
	 */
	columns: [number, number] | number[];
}

export interface DataToolDataResponse extends DataToolMessage {
	columns: Array<DataToolColumnData>;

	/**
	 * Analogous to R's row.names or pandas.Index. Can be an Array because
	 * of pandas's MultiIndex. Usually this will be not present or an array
	 * of length 1.
	 */
	row_labels?: Array<DataToolColumnData>;
}

export interface DataToolColumnData {
	/**
	 * Stringified representation of the requested values.
	 */
	data: Array<string>;
}

export interface DataToolFilterRequest extends DataToolMessage {
	/**
	 * Set of filters to apply to the dataset. Replaces any currently set
	 * filters. To clear filters, pass an empty array.
	 */
	filters: Array<DataToolFilter>;
}

/**
 * Indicate column to apply to either by name or by index.
 */
export type DataToolColumnRef = string | number;

export type DataToolFilterType = 'isnull' | 'notnull' | 'compare'
	| 'set' | 'search';

export interface DataToolFilter {
	filter_type: DataToolFilterType;

	/**
	 * Unique id to identify filter in UI and for backends to know whether a
	 * filter sent in a request as been seen before (for possible reuse of results.)
	 */
	filter_id: string;

	column: DataToolColumnRef;
}

export interface DataToolCompareFilter extends DataToolFilter {
	operation: '=' | '!=' | '<' | '<=' | '>' | '>=';

	/**
	 * Stringified column value, to be coerced by the backend back to the
	 * actual column type.
	 */
	value: string;
}

export interface DataToolSetFilter extends DataToolFilter {
	/**
	 * Values to include/exclude when filtering. Backend will coerce
	 * these to the actual column type.
	 */
	values: Array<string>;

	/**
	 * Filter by including only values in set (true) or excluding
	 * them (false).
	 */
	include: boolean;
}

export interface DataToolSearchFilter extends DataToolFilter {
	search_type: 'startswith' | 'endswith' | 'contains' | 'regex';

	/**
	 * Substring to search for in stringified values. For non-string data,
	 * the search should be applied to the stringified data. For example,
	 * the substring '123' could be found in the numbers 12345 or 71239.
	 */
	value: string;

	/**
	 * If true, perform only a case-sensitive search.
	 */
	case_sensitive: boolean;
}

export interface DataToolFilterResponse extends DataToolMessage {
	/**
	 * Active filters in the backend are echoed.
	 */
	filters: Array<DataToolFilter>;

	/**
	 * Number of rows in dataset after applying filters.
	 */
	selected_num_rows: number;
}

/**
 * Set or clear sorting state in dataset in backend.
 */
export interface DataToolSortRequest extends DataToolMessage {
	/**
	 * Pass zero or more keys to sort by. To clear sorting, pass an empty
	 * array. Like filtering, replaces any existing sorting state.
	 */
	sort_keys: Array<DataToolSortKey>;
}

export interface DataToolSortResponse extends DataToolMessage {
	/**
	 * Echo sorting state of dataset in response.
	 */
	sort_keys: Array<DataToolSortKey>;
}

/**
 * Indicates column to sort table by.
 */
export interface DataToolSortKey {
	key_id: string;

	column: DataToolColumnRef;

	/**
	 * Sort order, ascending (true) or descending (false).
	 */
	ascending: boolean;
}

/**
 * Types of column profiles for visual representation of data distribution.
 */
export type DataToolProfileType = 'freqtable' | 'histogram';

export interface DataToolProfileRequest extends DataToolMessage {
	kind: DataToolProfileType;

	column: DataToolColumnRef;

	/**
	 * Identifier for this profile request, so that multiple column
	 * profile requests can be issued and linked back with their destination in the UI.
	 */
	profile_id: string;
}

export interface DataToolProfileResponse extends DataToolMessage {
	kind: DataToolProfileType;

	/**
	 * Identifier for this profile request, so that multiple column
	 * profile requests can be issued and linked back with their destination in the UI.
	 */
	profile_id: string;

	/**
	 * Number of null values in column. (This could also be split into a
	 * separate profile request).
	 */
	null_count: number;
}

/**
 * Structure to represent sample quantiles as part of a histogram.
 */
export interface DataToolQuantileValue {
	/**
	 * Quantile number (percentile). E.g. 1 for 1%, 50% for median, etc.
	 */
	q: number;

	/**
	 * Stringified value of quantile value.
	 */
	value: string;

	/**
	 * Result is exact (true, computed from raw data) or approximate
	 * (false, computed from binned data or using a sketch).
	 */
	exact: boolean;
}

export interface DataToolHistogramResponse extends DataToolProfileResponse {
	min_value: string;
	max_value: string;
	mean_value: string;

	/**
	 * The computed histogram starting from the minimum value with steps
	 * equal to the bin width.
	 */
	bin_counts: Array<number>;
	bin_width: number;

	/**
	 * Quantile values, typically among 1 / 25 / 50 / 75 / 99.
	 */
	quantiles: Array<DataToolQuantileValue>;
}

export interface DataToolFreqTableResponse extends DataToolProfileResponse {
	frequencies: Array<{
		value: string;
		count: number;
	}>;

	/**
	 * If frequency table was truncated — e.g. if it exceeded a certain
	 * length — then we return the number of "other" values that are not
	 * represented in the counts in "frequencies".
	 */
	other_count: number;
}

export interface DataToolStateRequest extends DataToolMessage { }

export interface DataToolStateResponse extends DataToolMessage {
	filters: Array<DataToolFilter>;

	sort_keys: Array<DataToolSortKey>;
}

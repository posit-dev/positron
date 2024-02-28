/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from 'vs/base/common/uuid';
import {
	ColumnFilter,
	ColumnFilterCompareOp,
	ColumnFilterFilterType,
	ColumnFilterSearchType,
	ColumnSchema,
	ProfileResult,
	TableData,
	TableSchema
} from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';

const exampleTypes: [string, string, object][] = [
	['int64', 'number', {}],
	['string', 'string', {}],
	['boolean', 'boolean', {}],
	['double', 'number', {}],
	['timestamp', 'datetime', { timezone: 'America/New_York' }]
];

export function getTableSchema(numRows: number = 100, numColumns: number = 10): TableSchema {
	const columns = [];
	for (let i = 0; i < numColumns; i++) {
		const typeProto = exampleTypes[i % exampleTypes.length];
		columns.push(getColumnSchema('column_' + i, typeProto[0], typeProto[1], typeProto[2]));
	}
	return {
		columns: columns,
	};
}

// If you want to add other examples, just append them to the arrays of strings.
// They do not have to be all the same length.
const exampleTypeData: Record<string, string[]> = {
	'int64': ['-12345', '-1', '0', 'null', '1', '12345'],
	'string': ['Greetings', 'Gr\u00FC\u00DFe', 'Saludos', 'null'],
	'boolean': ['true', 'false', 'null'],
	'double': ['1.2345', '-1.2e-17', '0.0', 'null'],
	'timestamp': ['2021-12-20 12:34:45', '1970-01-01 00:00:00']
};

/**
 * Generate some "random" data for the table based on a hand-written prototype, so the results
 * are always deterministic given a particular schema's types.
 * @param schema the schema of the table to generate data from
 * @param rowStartIndex
 * @param numRows
 * @param columnIndices Columns to select by index. Can be sequetial, sparse, or random
 */
export function getExampleTableData(shape: [number, number], schema: TableSchema, rowStartIndex: number,
	numRows: number, columnIndices: Array<number>): TableData {
	const generatedColumns = [];

	// Don't generate virtual data beyond the extent of the table, and if
	// rowStartIndex is at or after end of the table, return nothing
	numRows = Math.max(Math.min(numRows, shape[0] - rowStartIndex), 0);

	for (const columnIndex of columnIndices) {
		const exampleValues: string[] = exampleTypeData[schema.columns[columnIndex].type_name];

		// Just repeat these values deterministically up until the "end" of the table
		const generatedColumn = [];
		if (numRows > 0) {
			for (let i = rowStartIndex; i < rowStartIndex + numRows; i++) {
				generatedColumn.push(exampleValues[i % exampleValues.length] + ` {i}`);
			}
		}
		generatedColumns.push(generatedColumn);
	}
	return {
		columns: generatedColumns,
		row_labels: []
	};
}

export function getColumnSchema(colName: string, typeName: string, typeDisplay: string,
	extraProps: object = {}): ColumnSchema {
	return {
		column_name: colName,
		type_name: typeName,
		type_display: typeDisplay,
		...extraProps
	} as ColumnSchema;
}

export function getExampleHistogram(): ProfileResult {
	// This example is basically made up.
	return {
		null_count: 10,
		min_value: '0',
		max_value: '100',
		mean_value: '50',
		histogram_bin_sizes: [4, 10, 15, 20, 7, 6, 0, 2, 50, 21],
		histogram_bin_width: 10,
		histogram_quantiles: [
			{ q: 25, value: '25', exact: true },
			{ q: 50, value: '70', exact: true },
			{ q: 75, value: '82', exact: true }
		],
	} as ProfileResult;
}

export function getExampleFreqtable(): ProfileResult {
	return {
		null_count: 10,
		freqtable_counts: [
			{ value: 'foo1', count: 25 },
			{ value: 'bar22', count: 10 },
			{ value: 'baz3333', count: 7 },
			{ value: 'qux444444', count: 2 }
		],
		freqtable_other_count: 12
	} as ProfileResult;
}

// For filtering

function _getFilterWithProps(columnIndex: number, filterType: ColumnFilterFilterType,
	props: Partial<ColumnFilter> = {}): ColumnFilter {
	return {
		filter_id: generateUuid(),
		filter_type: filterType,
		column_index: columnIndex,
		...props
	} as ColumnFilter;
}

export function getCompareFilter(columnIndex: number, op: ColumnFilterCompareOp,
	value: string) {
	return _getFilterWithProps(columnIndex, ColumnFilterFilterType.Compare, {
		compare_op: op,
		compare_value: value
	});
}

export function getIsNullFilter(columnIndex: number) {
	return _getFilterWithProps(columnIndex, ColumnFilterFilterType.Isnull);
}

export function getNotNullFilter(columnIndex: number) {
	return _getFilterWithProps(columnIndex, ColumnFilterFilterType.Notnull);
}

export function getSetMemberFilter(columnIndex: number, values: string[], inclusive: boolean) {
	return _getFilterWithProps(columnIndex, ColumnFilterFilterType.SetMembership, {
		set_member_values: values,
		set_member_inclusive: inclusive
	});
}

export function getTextSearchFilter(columnIndex: number, searchTerm: string,
	searchType: ColumnFilterSearchType, caseSensitive: boolean) {
	return _getFilterWithProps(columnIndex, ColumnFilterFilterType.Search, {
		search_term: searchTerm,
		search_type: searchType,
		search_case_sensitive: caseSensitive
	});
}

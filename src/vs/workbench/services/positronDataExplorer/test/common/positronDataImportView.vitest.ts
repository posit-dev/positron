/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { buildDataImportView } from '../../common/positronDataImportView.js';
import {
	ColumnDisplayType, ColumnSchema, FilterComparisonOp, RowFilter,
	RowFilterCondition, RowFilterType, TableSchema, TextSearchType,
} from '../../../languageRuntime/common/positronDataExplorerComm.js';

function makeColumnSchema(overrides: Partial<ColumnSchema>): ColumnSchema {
	return {
		column_name: 'carrier',
		column_index: 0,
		type_name: 'VARCHAR',
		type_display: ColumnDisplayType.String,
		...overrides,
	};
}

function makeRowFilter(overrides: Partial<RowFilter>): RowFilter {
	return {
		filter_id: 'f1',
		filter_type: RowFilterType.Compare,
		column_schema: makeColumnSchema({}),
		condition: RowFilterCondition.And,
		params: { op: FilterComparisonOp.Eq, value: 'UA' },
		...overrides,
	};
}

/** getSchema stub that answers with one column per requested index, named col<index>. */
const getSchema = vi.fn(async (columnIndices: number[]): Promise<TableSchema> => ({
	columns: columnIndices.map(index => makeColumnSchema({
		column_name: `col${index}`,
		column_index: index,
		type_display: ColumnDisplayType.Integer,
	})),
}));

describe('buildDataImportView', () => {
	it('returns undefined for an unfiltered, unsorted view without calling getSchema', async () => {
		const view = await buildDataImportView(
			{ row_filters: [], sort_keys: [] },
			getSchema
		);
		expect(view).toBeUndefined();
		expect(getSchema).not.toHaveBeenCalled();
	});

	it('maps a compare filter with the column name, type, condition, op and value', async () => {
		const view = await buildDataImportView(
			{ row_filters: [makeRowFilter({})], sort_keys: [] },
			getSchema
		);
		expect(view?.rowFilters).toEqual([{
			columnName: 'carrier',
			columnType: 'string',
			condition: 'and',
			filterType: 'compare',
			op: '=',
			value: 'UA',
		}]);
	});

	it('maps each remaining row filter type to its discriminated shape', async () => {
		const view = await buildDataImportView(
			{
				row_filters: [
					makeRowFilter({
						filter_type: RowFilterType.Between,
						params: { left_value: '1', right_value: '9' },
						column_schema: makeColumnSchema({ column_name: 'n', type_display: ColumnDisplayType.Integer }),
					}),
					makeRowFilter({
						filter_type: RowFilterType.Search,
						condition: RowFilterCondition.Or,
						params: { search_type: TextSearchType.StartsWith, term: 'UA', case_sensitive: false },
					}),
					makeRowFilter({
						filter_type: RowFilterType.SetMembership,
						params: { values: ['UA', 'AA'], inclusive: true },
					}),
					makeRowFilter({ filter_type: RowFilterType.IsNull, params: undefined }),
				],
				sort_keys: [],
			},
			getSchema
		);
		expect(view?.rowFilters).toMatchInlineSnapshot(`
			[
			  {
			    "columnName": "n",
			    "columnType": "integer",
			    "condition": "and",
			    "filterType": "between",
			    "leftValue": "1",
			    "rightValue": "9",
			  },
			  {
			    "caseSensitive": false,
			    "columnName": "carrier",
			    "columnType": "string",
			    "condition": "or",
			    "filterType": "search",
			    "searchType": "starts_with",
			    "term": "UA",
			  },
			  {
			    "columnName": "carrier",
			    "columnType": "string",
			    "condition": "and",
			    "filterType": "set_membership",
			    "inclusive": true,
			    "values": [
			      "UA",
			      "AA",
			    ],
			  },
			  {
			    "columnName": "carrier",
			    "columnType": "string",
			    "condition": "and",
			    "filterType": "is_null",
			  },
			]
		`);
	});

	it('excludes row filters the backend marked invalid', async () => {
		const view = await buildDataImportView(
			{
				row_filters: [makeRowFilter({ is_valid: false })],
				sort_keys: [],
			},
			getSchema
		);
		expect(view).toBeUndefined();
	});

	it('resolves sort key column indexes to names via getSchema', async () => {
		const view = await buildDataImportView(
			{
				row_filters: [],
				sort_keys: [
					{ column_index: 3, ascending: true },
					{ column_index: 1, ascending: false },
				],
			},
			getSchema
		);
		expect(getSchema).toHaveBeenCalledWith([3, 1]);
		expect(view?.sortKeys).toEqual([
			{ columnName: 'col3', ascending: true },
			{ columnName: 'col1', ascending: false },
		]);
	});

	it('offers no view when a sort key index is missing from the schema', async () => {
		const view = await buildDataImportView(
			{
				row_filters: [makeRowFilter({ filter_type: RowFilterType.IsNull, params: undefined })],
				sort_keys: [{ column_index: 7, ascending: true }],
			},
			vi.fn().mockResolvedValue({ columns: [] })
		);
		expect(view).toBeUndefined();
	});
});

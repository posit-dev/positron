/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { DuckDBRow } from '../duckdbWorkerClient.js';
import { DuckDBSchemaEntry, DuckDBTableView, duckdbDisplayType, makeWhereExpr } from '../duckdbTableView.js';
import {
	ColumnDisplayType,
	ColumnValue,
	FilterComparisonOp,
	FormatOptions,
	RowFilter,
	RowFilterType,
	TextSearchType,
} from 'positron-data-explorer-protocol';

/** A fake query client that records SQL and answers from a caller-supplied responder. */
class FakeQueryClient {
	readonly queries: string[] = [];
	constructor(private readonly responder: (sql: string) => DuckDBRow[]) { }
	async runQuery(sql: string, _params?: Record<string, string>): Promise<DuckDBRow[]> {
		this.queries.push(sql);
		return this.responder(sql);
	}
}

const FORMAT: FormatOptions = {
	large_num_digits: 2,
	small_num_digits: 4,
	max_integral_digits: 7,
	max_value_length: 100,
};

/** Builds a row filter against a column with the given display type. */
function rowFilter(columnName: string, displayType: ColumnDisplayType, filter: Partial<RowFilter>): RowFilter {
	return {
		filter_id: 'f',
		filter_type: RowFilterType.Compare,
		column_schema: { column_name: columnName, column_index: 0, type_name: '', type_display: displayType },
		condition: 'and',
		...filter,
	} as RowFilter;
}

suite('DuckDB Data Explorer Tests', () => {
	suite('duckdbDisplayType', () => {
		test('maps DuckDB type names to display types', () => {
			const mapping = ([
				['INTEGER', ColumnDisplayType.Integer],
				['BIGINT', ColumnDisplayType.Integer],
				['VARCHAR', ColumnDisplayType.String],
				['DOUBLE', ColumnDisplayType.Floating],
				['FLOAT', ColumnDisplayType.Floating],
				['DECIMAL(18,3)', ColumnDisplayType.Decimal],
				['BOOLEAN', ColumnDisplayType.Boolean],
				['TIMESTAMP', ColumnDisplayType.Datetime],
				['DATE', ColumnDisplayType.Date],
				['TIME', ColumnDisplayType.Time],
				['INTERVAL', ColumnDisplayType.Interval],
				['BLOB', ColumnDisplayType.Object],
				['UUID', ColumnDisplayType.String],
			] as Array<[string, ColumnDisplayType]>).map(([type]) => duckdbDisplayType(type));
			assert.deepStrictEqual(mapping, [
				ColumnDisplayType.Integer, ColumnDisplayType.Integer, ColumnDisplayType.String,
				ColumnDisplayType.Floating, ColumnDisplayType.Floating, ColumnDisplayType.Decimal,
				ColumnDisplayType.Boolean, ColumnDisplayType.Datetime, ColumnDisplayType.Date,
				ColumnDisplayType.Time, ColumnDisplayType.Interval, ColumnDisplayType.Object,
				ColumnDisplayType.String,
			]);
		});
	});

	suite('makeWhereExpr', () => {
		test('builds DuckDB-dialect predicates for each filter type', () => {
			const exprs = [
				makeWhereExpr(rowFilter('age', ColumnDisplayType.Integer, {
					filter_type: RowFilterType.Compare,
					params: { op: FilterComparisonOp.GtEq, value: '18' },
				})),
				makeWhereExpr(rowFilter('flag', ColumnDisplayType.Boolean, { filter_type: RowFilterType.IsTrue })),
				makeWhereExpr(rowFilter('city', ColumnDisplayType.String, {
					filter_type: RowFilterType.SetMembership,
					params: { values: ['NYC', 'LA'], inclusive: true },
				})),
				makeWhereExpr(rowFilter('name', ColumnDisplayType.String, {
					filter_type: RowFilterType.Search,
					params: { search_type: TextSearchType.RegexMatch, term: '^a.*', case_sensitive: true },
				})),
			];
			assert.deepStrictEqual(exprs, [
				'"age" >= 18',
				'"flag" = true',
				`"city" IN ('NYC', 'LA')`,
				`regexp_matches("name", '^a.*')`,
			]);
		});
	});

	suite('getDataValues', () => {
		const schema: DuckDBSchemaEntry[] = [
			{ column_name: 'id', column_type: 'INTEGER', type_display: ColumnDisplayType.Integer },
			{ column_name: 'score', column_type: 'DOUBLE', type_display: ColumnDisplayType.Floating },
		];

		test('formats values, encodes null/NaN/Inf sentinels, and queries the qualified table', async () => {
			const client = new FakeQueryClient(sql => {
				if (sql.includes('count(*)')) {
					return [{ n: 3 }];
				}
				return [
					{ c0: 1, c1: 0.5 },
					{ c0: 2, c1: null },
					{ c0: 3, c1: Infinity },
				];
			});
			const view = new DuckDBTableView(client, '"main"."people"', 'people', 'table', schema);
			const data = await view.getDataValues({
				columns: [
					{ column_index: 0, spec: { first_index: 0, last_index: 2 } },
					{ column_index: 1, spec: { first_index: 0, last_index: 2 } },
				],
				format_options: FORMAT,
			});
			const dataQuery = client.queries.find(q => q.includes('OFFSET'))!;
			assert.deepStrictEqual(
				{
					fromQualifiedTable: dataQuery.includes('FROM "main"."people"'),
					columns: data.columns,
				},
				{
					fromQualifiedTable: true,
					columns: [
						['1', '2', '3'],
						['0.5000', 0 as ColumnValue, 10 as ColumnValue],
					],
				}
			);
		});
	});

	suite('single-column projection', () => {
		test('a one-column schema reports and queries only that column', async () => {
			const oneColumn: DuckDBSchemaEntry[] = [
				{ column_name: 'score', column_type: 'DOUBLE', type_display: ColumnDisplayType.Floating },
			];
			const client = new FakeQueryClient(sql =>
				sql.includes('count(*)') ? [{ n: 2 }] : [{ c0: 1.5 }, { c0: 2.5 }]);
			const view = new DuckDBTableView(client, '"main"."people"', 'people', 'table', oneColumn);

			const state = await view.getState();
			const data = await view.getDataValues({
				columns: [{ column_index: 0, spec: { first_index: 0, last_index: 1 } }],
				format_options: FORMAT,
			});

			assert.deepStrictEqual(
				{ numColumns: state.table_shape.num_columns, columns: data.columns },
				{ numColumns: 1, columns: [['1.50', '2.50']] }
			);
		});
	});
});

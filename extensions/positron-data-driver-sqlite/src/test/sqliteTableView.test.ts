/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { SqliteRow } from '../sqliteWorkerClient.js';
import { SqliteBindValue } from '../sqliteWorkerProtocol.js';
import { SqliteSchemaEntry, SqliteTableView, makeWhereExpr, sqliteDisplayType } from '../sqliteTableView.js';
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
	constructor(private readonly responder: (sql: string) => SqliteRow[]) { }
	async runQuery(sql: string, _params?: SqliteBindValue[]): Promise<SqliteRow[]> {
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

suite('SQLite Data Explorer Tests', () => {
	suite('sqliteDisplayType', () => {
		test('maps declared types via name and affinity rules', () => {
			const mapping = ([
				['INTEGER', ColumnDisplayType.Integer],
				['BIGINT', ColumnDisplayType.Integer],
				['VARCHAR(50)', ColumnDisplayType.String],
				['TEXT', ColumnDisplayType.String],
				['REAL', ColumnDisplayType.Floating],
				['DOUBLE', ColumnDisplayType.Floating],
				['DECIMAL(10,2)', ColumnDisplayType.Decimal],
				['BOOLEAN', ColumnDisplayType.Boolean],
				['DATETIME', ColumnDisplayType.Datetime],
				['TIMESTAMP', ColumnDisplayType.Datetime],
				['DATE', ColumnDisplayType.Date],
				['TIME', ColumnDisplayType.Time],
				['BLOB', ColumnDisplayType.Object],
				['', ColumnDisplayType.Object],
				['NUMERIC', ColumnDisplayType.Floating],
			] as Array<[string, ColumnDisplayType]>).map(([type]) => sqliteDisplayType(type));
			assert.deepStrictEqual(mapping, [
				ColumnDisplayType.Integer, ColumnDisplayType.Integer, ColumnDisplayType.String,
				ColumnDisplayType.String, ColumnDisplayType.Floating, ColumnDisplayType.Floating,
				ColumnDisplayType.Decimal, ColumnDisplayType.Boolean, ColumnDisplayType.Datetime,
				ColumnDisplayType.Datetime, ColumnDisplayType.Date, ColumnDisplayType.Time,
				ColumnDisplayType.Object, ColumnDisplayType.Object, ColumnDisplayType.Floating,
			]);
		});
	});

	suite('makeWhereExpr', () => {
		test('builds SQLite-dialect predicates for each filter type', () => {
			const exprs = [
				makeWhereExpr(rowFilter('age', ColumnDisplayType.Integer, {
					filter_type: RowFilterType.Compare,
					params: { op: FilterComparisonOp.GtEq, value: '18' },
				})),
				makeWhereExpr(rowFilter('name', ColumnDisplayType.String, {
					filter_type: RowFilterType.Compare,
					params: { op: FilterComparisonOp.Eq, value: 'O\'Hara' },
				})),
				makeWhereExpr(rowFilter('city', ColumnDisplayType.String, {
					filter_type: RowFilterType.SetMembership,
					params: { values: ['NYC', 'LA'], inclusive: true },
				})),
				makeWhereExpr(rowFilter('name', ColumnDisplayType.String, {
					filter_type: RowFilterType.Search,
					params: { search_type: TextSearchType.Contains, term: 'an', case_sensitive: false },
				})),
				makeWhereExpr(rowFilter('name', ColumnDisplayType.String, {
					filter_type: RowFilterType.Search,
					params: { search_type: TextSearchType.RegexMatch, term: '^a.*', case_sensitive: true },
				})),
				makeWhereExpr(rowFilter('x', ColumnDisplayType.Integer, { filter_type: RowFilterType.IsNull })),
			];
			assert.deepStrictEqual(exprs, [
				'"age" >= 18',
				`"name" = 'O''Hara'`,
				`"city" IN ('NYC', 'LA')`,
				`lower("name") LIKE '%' || lower('an') || '%'`,
				`regexp('^a.*', "name")`,
				'"x" IS NULL',
			]);
		});
	});

	suite('getDataValues', () => {
		const schema: SqliteSchemaEntry[] = [
			{ column_name: 'id', column_type: 'INTEGER', type_display: ColumnDisplayType.Integer },
			{ column_name: 'score', column_type: 'REAL', type_display: ColumnDisplayType.Floating },
		];

		test('formats values and encodes null/NaN/Inf sentinels', async () => {
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
			const view = new SqliteTableView(client, 'people', 'table', schema);
			const data = await view.getDataValues({
				columns: [
					{ column_index: 0, spec: { first_index: 0, last_index: 2 } },
					{ column_index: 1, spec: { first_index: 0, last_index: 2 } },
				],
				format_options: FORMAT,
			});
			assert.deepStrictEqual(data.columns, [
				['1', '2', '3'],
				['0.5000', 0 as ColumnValue, 10 as ColumnValue],
			]);
		});

		test('paginates with LIMIT/OFFSET and a rowid tiebreaker once sorted', async () => {
			const client = new FakeQueryClient(sql => (sql.includes('count(*)') ? [{ n: 10 }] : [{ c0: 5 }]));
			const view = new SqliteTableView(client, 'people', 'table', schema);
			await view.setSortColumns({ sort_keys: [{ column_index: 0, ascending: false }] });
			await view.getDataValues({
				columns: [{ column_index: 0, spec: { first_index: 2, last_index: 2 } }],
				format_options: FORMAT,
			});
			const dataQuery = client.queries.find(q => q.includes('LIMIT'))!;
			assert.match(dataQuery, /ORDER BY "id" DESC, rowid\s+LIMIT 1 OFFSET 2/);
		});
	});

	suite('single-column projection', () => {
		test('a one-column schema reports and queries only that column', async () => {
			const oneColumn: SqliteSchemaEntry[] = [
				{ column_name: 'score', column_type: 'REAL', type_display: ColumnDisplayType.Floating },
			];
			const client = new FakeQueryClient(sql =>
				sql.includes('count(*)') ? [{ n: 2 }] : [{ c0: 1.5 }, { c0: 2.5 }]);
			const view = new SqliteTableView(client, 'people', 'table', oneColumn);

			const state = await view.getState();
			const data = await view.getDataValues({
				columns: [{ column_index: 0, spec: { first_index: 0, last_index: 1 } }],
				format_options: FORMAT,
			});
			const dataQuery = client.queries.find(q => q.includes('OFFSET'))!;

			assert.deepStrictEqual(
				{
					numColumns: state.table_shape.num_columns,
					selectsOnlyScore: /^SELECT "score" AS c0 FROM "people"/.test(dataQuery),
					columns: data.columns,
				},
				{ numColumns: 1, selectsOnlyScore: true, columns: [['1.50', '2.50']] }
			);
		});
	});
});

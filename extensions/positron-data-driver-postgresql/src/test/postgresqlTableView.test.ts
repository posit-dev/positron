/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { IPostgresQueryClient, PostgresSchemaEntry, PostgresTableView, makeWhereExpr, postgresDisplayType } from '../postgresqlTableView.js';
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
class FakeQueryClient implements IPostgresQueryClient {
	readonly queries: string[] = [];
	constructor(private readonly responder: (sql: string) => Array<Record<string, unknown>>) { }
	async runQuery(sql: string): Promise<Array<Record<string, unknown>>> {
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

suite('PostgreSQL Data Explorer Tests', () => {
	suite('postgresDisplayType', () => {
		test('maps PostgreSQL type names to display types', () => {
			const mapping = ([
				['integer', ColumnDisplayType.Integer],
				['bigint', ColumnDisplayType.Integer],
				['character varying', ColumnDisplayType.String],
				['text', ColumnDisplayType.String],
				['double precision', ColumnDisplayType.Floating],
				['real', ColumnDisplayType.Floating],
				['numeric', ColumnDisplayType.Decimal],
				['boolean', ColumnDisplayType.Boolean],
				['timestamp without time zone', ColumnDisplayType.Datetime],
				['date', ColumnDisplayType.Date],
				['time without time zone', ColumnDisplayType.Time],
				['bytea', ColumnDisplayType.Object],
				['uuid', ColumnDisplayType.String],
			] as Array<[string, ColumnDisplayType]>).map(([type]) => postgresDisplayType(type));
			assert.deepStrictEqual(mapping, [
				ColumnDisplayType.Integer, ColumnDisplayType.Integer, ColumnDisplayType.String,
				ColumnDisplayType.String, ColumnDisplayType.Floating, ColumnDisplayType.Floating,
				ColumnDisplayType.Decimal, ColumnDisplayType.Boolean, ColumnDisplayType.Datetime,
				ColumnDisplayType.Date, ColumnDisplayType.Time, ColumnDisplayType.Object,
				ColumnDisplayType.String,
			]);
		});
	});

	suite('makeWhereExpr', () => {
		test('builds PostgreSQL-dialect predicates for each filter type', () => {
			const exprs = [
				makeWhereExpr(rowFilter('age', ColumnDisplayType.Integer, {
					filter_type: RowFilterType.Compare,
					params: { op: FilterComparisonOp.GtEq, value: '18' },
				})),
				makeWhereExpr(rowFilter('flag', ColumnDisplayType.Boolean, { filter_type: RowFilterType.IsFalse })),
				makeWhereExpr(rowFilter('city', ColumnDisplayType.String, {
					filter_type: RowFilterType.SetMembership,
					params: { values: ['NYC', 'LA'], inclusive: true },
				})),
				makeWhereExpr(rowFilter('name', ColumnDisplayType.String, {
					filter_type: RowFilterType.Search,
					params: { search_type: TextSearchType.RegexMatch, term: '^a.*', case_sensitive: false },
				})),
			];
			assert.deepStrictEqual(exprs, [
				'"age" >= 18',
				'"flag" = false',
				`"city" IN ('NYC', 'LA')`,
				`"name" ~* '^a.*'`,
			]);
		});
	});

	suite('getDataValues', () => {
		const schema: PostgresSchemaEntry[] = [
			{ column_name: 'id', column_type: 'integer', type_display: ColumnDisplayType.Integer },
			{ column_name: 'score', column_type: 'double precision', type_display: ColumnDisplayType.Floating },
		];

		test('formats values, encodes null/Inf sentinels, and queries the qualified table', async () => {
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
			const view = new PostgresTableView(client, '"public"."people"', 'people', 'table', schema);
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
					fromQualifiedTable: dataQuery.includes('FROM "public"."people"'),
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
			const oneColumn: PostgresSchemaEntry[] = [
				{ column_name: 'score', column_type: 'double precision', type_display: ColumnDisplayType.Floating },
			];
			const client = new FakeQueryClient(sql =>
				sql.includes('count(*)') ? [{ n: 2 }] : [{ c0: 1.5 }, { c0: 2.5 }]);
			const view = new PostgresTableView(client, '"public"."people"', 'people', 'table', oneColumn);

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

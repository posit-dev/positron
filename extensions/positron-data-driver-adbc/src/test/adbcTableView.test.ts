/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import {
	AdbcSchemaEntry,
	AdbcTableView,
	adbcDisplayType,
	makeWhereExpr,
} from '../adbcTableView.js';
import { makeQuoteIdentifier, quoteIdentifierAs } from '../adbcDialect.js';
import { tableRef } from '../adbcDataExplorerRpcHandler.js';
import { IAdbcQueryClient } from '../adbcWorkerClient.js';
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
class FakeQueryClient implements IAdbcQueryClient {
	readonly queries: string[] = [];
	constructor(private readonly responder: (sql: string) => Array<Record<string, unknown>> = () => []) { }
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

/** The SQL-standard quoter; these tests assert on ANSI output unless stated otherwise. */
const ANSI = makeQuoteIdentifier('ansi');

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

/** A two-column schema used by the table-view tests. */
const SCHEMA: AdbcSchemaEntry[] = [
	{ column_name: 'id', column_type: 'Int64', type_display: ColumnDisplayType.Integer },
	{ column_name: 'name', column_type: 'Utf8', type_display: ColumnDisplayType.String },
];

suite('ADBC Data Explorer Tests', () => {
	suite('adbcDisplayType', () => {
		test('maps Arrow type ids to display types', () => {
			// Arrow Type enum ids: Null 1, Int 2, Float 3, Binary 4, Utf8 5, Bool 6, Decimal 7,
			// Date 8, Time 9, Timestamp 10, Interval 11, List 12, Struct 13, Map 17,
			// Duration 18, LargeUtf8 20.
			const mapping: Array<[number, ColumnDisplayType]> = [
				[6, ColumnDisplayType.Boolean],
				[2, ColumnDisplayType.Integer],
				[3, ColumnDisplayType.Floating],
				[7, ColumnDisplayType.Decimal],
				[5, ColumnDisplayType.String],
				[20, ColumnDisplayType.String],
				[8, ColumnDisplayType.Date],
				[9, ColumnDisplayType.Time],
				[10, ColumnDisplayType.Datetime],
				[11, ColumnDisplayType.Interval],
				[18, ColumnDisplayType.Interval],
				[12, ColumnDisplayType.Array],
				[13, ColumnDisplayType.Struct],
				[17, ColumnDisplayType.Struct],
				[4, ColumnDisplayType.Object],
				[1, ColumnDisplayType.Unknown],
				// An id the mapping does not know about still yields a usable display type.
				[99, ColumnDisplayType.Unknown],
			];
			assert.deepStrictEqual(
				mapping.map(([typeId]) => [typeId, adbcDisplayType(typeId)]),
				mapping);
		});
	});

	suite('quoteIdentifier and tableRef', () => {
		test('quotes identifiers and doubles embedded quotes', () => {
			assert.strictEqual(ANSI('my "odd" name'), '"my ""odd"" name"');
		});

		test('qualifies a table with its catalog and schema', () => {
			assert.strictEqual(
				tableRef({ catalog: 'main', dbSchema: 'public', tableName: 'orders' }, ANSI),
				'"main"."public"."orders"');
		});

		test('omits catalog and schema levels the driver reports empty', () => {
			// SQLite reports an empty schema name; qualifying with it would produce invalid SQL.
			assert.strictEqual(tableRef({ catalog: 'main', dbSchema: '', tableName: 't' }, ANSI), '"main"."t"');
			assert.strictEqual(tableRef({ tableName: 't' }, ANSI), '"t"');
		});
	});

	suite('makeWhereExpr', () => {
		test('builds portable expressions for the supported filters', () => {
			const cases: Array<[string, RowFilter]> = [
				['"id" > 10', rowFilter('id', ColumnDisplayType.Integer, {
					filter_type: RowFilterType.Compare,
					params: { op: FilterComparisonOp.Gt, value: '10' },
				})],
				[`"name" = 'x'`, rowFilter('name', ColumnDisplayType.String, {
					filter_type: RowFilterType.Compare,
					params: { op: FilterComparisonOp.Eq, value: 'x' },
				})],
				['"id" BETWEEN 1 AND 5', rowFilter('id', ColumnDisplayType.Integer, {
					filter_type: RowFilterType.Between,
					params: { left_value: '1', right_value: '5' },
				})],
				['(NOT ("id" BETWEEN 1 AND 5))', rowFilter('id', ColumnDisplayType.Integer, {
					filter_type: RowFilterType.NotBetween,
					params: { left_value: '1', right_value: '5' },
				})],
				['"flag" = TRUE', rowFilter('flag', ColumnDisplayType.Boolean, { filter_type: RowFilterType.IsTrue })],
				['"flag" = FALSE', rowFilter('flag', ColumnDisplayType.Boolean, { filter_type: RowFilterType.IsFalse })],
				['"id" IS NULL', rowFilter('id', ColumnDisplayType.Integer, { filter_type: RowFilterType.IsNull })],
				['"id" IS NOT NULL', rowFilter('id', ColumnDisplayType.Integer, { filter_type: RowFilterType.NotNull })],
				[`"name" = ''`, rowFilter('name', ColumnDisplayType.String, { filter_type: RowFilterType.IsEmpty })],
				[`"name" <> ''`, rowFilter('name', ColumnDisplayType.String, { filter_type: RowFilterType.NotEmpty })],
				[`"name" IN ('a', 'b')`, rowFilter('name', ColumnDisplayType.String, {
					filter_type: RowFilterType.SetMembership,
					params: { values: ['a', 'b'], inclusive: true },
				})],
			];
			assert.deepStrictEqual(
				cases.map(([, filter]) => makeWhereExpr(filter, ANSI)),
				cases.map(([expected]) => expected));
		});

		test('uses LIKE with || concatenation for text search', () => {
			const search = (searchType: TextSearchType, caseSensitive: boolean) =>
				makeWhereExpr(rowFilter('name', ColumnDisplayType.String, {
					filter_type: RowFilterType.Search,
					params: { search_type: searchType, term: 'ab', case_sensitive: caseSensitive },
				}), ANSI);

			assert.deepStrictEqual(
				[
					search(TextSearchType.Contains, true),
					search(TextSearchType.Contains, false),
					search(TextSearchType.StartsWith, true),
					search(TextSearchType.EndsWith, true),
					search(TextSearchType.NotContains, true),
				],
				[
					`"name" LIKE '%' || 'ab' || '%'`,
					`lower("name") LIKE '%' || lower('ab') || '%'`,
					`"name" LIKE 'ab' || '%'`,
					`"name" LIKE '%' || 'ab'`,
					`"name" NOT LIKE '%' || 'ab' || '%'`,
				]);
		});

		test('escapes single quotes in a string literal', () => {
			assert.strictEqual(
				makeWhereExpr(rowFilter('name', ColumnDisplayType.String, {
					filter_type: RowFilterType.Compare,
					params: { op: FilterComparisonOp.Eq, value: 'O\'Brien' },
				}), ANSI),
				`"name" = 'O''Brien'`);
		});

		test('rejects a regex filter rather than emitting non-portable SQL', () => {
			// No SQL dialect for regex is common across the engines ADBC drivers front, so the
			// filter must fail loudly instead of silently matching the wrong rows.
			assert.throws(
				() => makeWhereExpr(rowFilter('name', ColumnDisplayType.String, {
					filter_type: RowFilterType.Search,
					params: { search_type: TextSearchType.RegexMatch, term: '^a', case_sensitive: true },
				}), ANSI),
				/Regular-expression filters are not supported/);
		});
	});

	suite('AdbcTableView', () => {
		test('counts rows against the qualified table reference', async () => {
			const client = new FakeQueryClient(() => [{ n: 42 }]);
			const view = new AdbcTableView(client, '"main"."public"."orders"', 'orders', SCHEMA, ANSI);

			const state = await view.getState();

			assert.deepStrictEqual(
				{ shape: state.table_shape, name: state.display_name, query: client.queries[0] },
				{
					shape: { num_rows: 42, num_columns: 2 },
					name: 'orders',
					query: 'SELECT count(*) AS n FROM "main"."public"."orders"',
				});
		});

		test('pages data with LIMIT and OFFSET under positional aliases', async () => {
			const client = new FakeQueryClient(sql =>
				sql.startsWith('SELECT count(*)')
					? [{ n: 10 }]
					: [{ c0: 1n, c1: 'a' }, { c0: 2n, c1: 'b' }]);
			const view = new AdbcTableView(client, '"t"', 't', SCHEMA, ANSI);

			const data = await view.getDataValues({
				columns: [
					{ column_index: 0, spec: { first_index: 0, last_index: 1 } },
					{ column_index: 1, spec: { first_index: 0, last_index: 1 } },
				],
				format_options: FORMAT,
			});

			assert.deepStrictEqual(
				{ columns: data.columns, query: client.queries[1] },
				{
					columns: [['1', '2'], ['a', 'b']] as ColumnValue[][],
					query: 'SELECT "id" AS c0, "name" AS c1 FROM "t" LIMIT 2 OFFSET 0',
				});
		});

		test('renders a null cell as the null sentinel', async () => {
			const client = new FakeQueryClient(sql =>
				sql.startsWith('SELECT count(*)') ? [{ n: 1 }] : [{ c0: null }]);
			const view = new AdbcTableView(client, '"t"', 't', SCHEMA, ANSI);

			const data = await view.getDataValues({
				columns: [{ column_index: 1, spec: { first_index: 0, last_index: 0 } }],
				format_options: FORMAT,
			});

			assert.deepStrictEqual(data.columns, [[0]] as ColumnValue[][]);
		});

		test('sorts without a row-identifier tiebreaker', async () => {
			// Unlike the PostgreSQL and SQLite drivers there is no portable ctid/rowid to append.
			const client = new FakeQueryClient(sql => sql.startsWith('SELECT count(*)') ? [{ n: 1 }] : []);
			const view = new AdbcTableView(client, '"t"', 't', SCHEMA, ANSI);

			await view.setSortColumns({ sort_keys: [{ column_index: 0, ascending: false }] });
			const code = await view.convertToCode({} as never);

			assert.deepStrictEqual(code.converted_code, ['SELECT *', 'FROM "t"', 'ORDER BY "id" DESC']);
		});

		test('applies row filters to the count and to generated code', async () => {
			const client = new FakeQueryClient(() => [{ n: 3 }]);
			const view = new AdbcTableView(client, '"t"', 't', SCHEMA, ANSI);

			const result = await view.setRowFilters({
				filters: [rowFilter('id', ColumnDisplayType.Integer, {
					filter_type: RowFilterType.Compare,
					params: { op: FilterComparisonOp.Gt, value: '5' },
				})],
			});
			const code = await view.convertToCode({} as never);

			assert.deepStrictEqual(
				{ rows: result.selected_num_rows, code: code.converted_code },
				{ rows: 3, code: ['SELECT *', 'FROM "t"', 'WHERE "id" > 5'] });
		});
	});
});

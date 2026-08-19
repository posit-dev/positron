/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { OdbcDialect } from '../odbcDatabases.js';
import { OdbcTableRef } from '../odbcNodes.js';
import { odbcDisplayType, OdbcSchemaEntry, OdbcTableView } from '../odbcTableView.js';
import { IOdbcQueryClient } from '../odbcWorkerClient.js';
import { OdbcRow } from '../odbcWorkerProtocol.js';
import {
	ColumnDisplayType,
	FilterComparisonOp,
	FormatOptions,
	RowFilter,
	RowFilterCondition,
	RowFilterParams,
	RowFilterType,
	TextSearchType,
} from 'positron-data-explorer-protocol';

/** Format options for the data reads below; the exact numbers do not matter to these assertions. */
const FORMAT_OPTIONS: FormatOptions = {
	large_num_digits: 2,
	small_num_digits: 4,
	max_integral_digits: 7,
	max_value_length: 100,
};

const LIMIT_OFFSET: OdbcDialect = { identifierQuote: '"', pagination: 'limit-offset' };
const OFFSET_FETCH: OdbcDialect = { identifierQuote: '"', pagination: 'offset-fetch' };
const BACKTICK: OdbcDialect = { identifierQuote: '`', pagination: 'limit-offset' };

const SCHEMA: OdbcSchemaEntry[] = [
	{ column_name: 'actor_id', column_type: 'int4', type_display: ColumnDisplayType.Integer },
	{ column_name: 'first_name', column_type: 'varchar', type_display: ColumnDisplayType.String },
];

/** A client that records the SQL it is asked to run and answers counts so construction settles. */
function createRecordingClient(): IOdbcQueryClient & { queries: string[] } {
	const queries: string[] = [];
	return {
		queries,
		runQuery: async (sql: string): Promise<OdbcRow[]> => {
			queries.push(sql);
			// Every query in these tests is either a count or a data read; a single row keyed for
			// both is enough for the view to make progress.
			return [{ n: 3, c0: 1, c1: 'Penelope' }];
		},
		tables: async () => [],
		columns: async () => [],
		primaryKeys: async () => [],
	};
}

/** The most recent query a recording client was asked to run. */
function lastQuery(client: { queries: string[] }): string {
	return client.queries[client.queries.length - 1];
}

function createView(dialect: OdbcDialect, ref?: Partial<OdbcTableRef>) {
	const client = createRecordingClient();
	const view = new OdbcTableView(
		client,
		{ schema: 'public', name: 'actor', kind: 'table', ...ref },
		dialect,
		SCHEMA
	);
	return { client, view };
}

/** The row filter shape the protocol requires, with the column schema the view reads back. */
function rowFilter(filterType: RowFilterType, columnIndex: number, params: RowFilterParams): RowFilter {
	const entry = SCHEMA[columnIndex];
	return {
		filter_id: `filter-${filterType}`,
		filter_type: filterType,
		column_schema: {
			column_name: entry.column_name,
			column_index: columnIndex,
			type_name: entry.column_type,
			type_display: entry.type_display,
		},
		condition: RowFilterCondition.And,
		params,
	};
}

suite('odbcDisplayType', () => {
	test('maps the ODBC SQL type codes, which are the same for every driver', () => {
		assert.deepStrictEqual(
			[
				[12, 'varchar'], [-9, 'nvarchar'], [4, 'int'], [-5, 'bigint'], [8, 'double'],
				[3, 'decimal'], [-7, 'bit'], [91, 'date'], [92, 'time'], [93, 'timestamp'],
				[-3, 'varbinary'],
			].map(([code, name]) => odbcDisplayType(code as number, name as string)),
			['string', 'string', 'integer', 'integer', 'floating', 'decimal', 'boolean', 'date', 'time', 'datetime', 'object']
		);
	});

	test('falls back to the type name for a code the specification does not define', () => {
		assert.deepStrictEqual(
			[
				odbcDisplayType(9999, 'BOOLEAN'),
				odbcDisplayType(undefined, 'BIGINT UNSIGNED'),
				odbcDisplayType(9999, 'VARIANT'),
			],
			['boolean', 'integer', 'object']
		);
	});
});

suite('OdbcTableView SQL', () => {
	test('writes the row window in the backend\'s own syntax', async () => {
		const limitOffset = createView(LIMIT_OFFSET);
		const offsetFetch = createView(OFFSET_FETCH);
		const request = {
			columns: [{ column_index: 0, spec: { first_index: 10, last_index: 12 } }],
			format_options: FORMAT_OPTIONS,
		};

		await limitOffset.view.getDataValues(request);
		await offsetFetch.view.getDataValues(request);

		assert.deepStrictEqual(
			{
				limitOffset: lastQuery(limitOffset.client),
				offsetFetch: lastQuery(offsetFetch.client),
			},
			{
				// The first column is appended as a tiebreaker so paging is reproducible; ODBC has
				// no portable row identity to use instead.
				limitOffset: 'SELECT "actor_id" AS c0 FROM "public"."actor"\nORDER BY "actor_id" LIMIT 3 OFFSET 10',
				offsetFetch: 'SELECT "actor_id" AS c0 FROM "public"."actor"\nORDER BY "actor_id" OFFSET 10 ROWS FETCH NEXT 3 ROWS ONLY',
			}
		);
	});

	test('quotes identifiers with the dialect\'s character and qualifies the table', async () => {
		const backtick = createView(BACKTICK, { catalog: 'sales', schema: undefined, name: 'or`ders' });
		await backtick.view.setRowFilters({ filters: [rowFilter(RowFilterType.IsNull, 0, {} as RowFilterParams)] });

		assert.strictEqual(
			lastQuery(backtick.client),
			// The embedded backtick is doubled, and the absent schema drops out of the reference.
			'SELECT count(*) AS n FROM `sales`.`or``ders`\nWHERE `actor_id` IS NULL'
		);
	});

	test('builds portable WHERE expressions, escaping LIKE wildcards', async () => {
		const { client, view } = createView(LIMIT_OFFSET);

		const filters = [
			rowFilter(RowFilterType.Compare, 0, { op: FilterComparisonOp.GtEq, value: '5' }),
			rowFilter(RowFilterType.Search, 1, { search_type: TextSearchType.Contains, term: '100%_x', case_sensitive: false }),
			rowFilter(RowFilterType.SetMembership, 1, { values: ['a', 'O\'Brien'], inclusive: true }),
		];
		await view.setRowFilters({ filters });

		assert.strictEqual(
			lastQuery(client),
			'SELECT count(*) AS n FROM "public"."actor"\nWHERE "actor_id" >= 5 AND ' +
			// LOWER rather than a case-insensitive LIKE, which is not portable; the wildcards in the
			// term are escaped with ! so "100%" matches that text and not every row starting "100".
			'LOWER("first_name") LIKE \'%100!%!_x%\' ESCAPE \'!\' AND ' +
			'"first_name" IN (\'a\', \'O\'\'Brien\')'
		);
	});

	test('refuses a regex filter rather than approximating it', async () => {
		const { view } = createView(LIMIT_OFFSET);
		const filters = [rowFilter(RowFilterType.Search, 1, {
			search_type: TextSearchType.RegexMatch, term: '^Pen', case_sensitive: true,
		})];

		await assert.rejects(
			() => view.setRowFilters({ filters }),
			/no common regular expression syntax/
		);
	});

	test('omits the paging tiebreaker from the SQL it hands the user', async () => {
		const { view } = createView(OFFSET_FETCH);
		await view.setSortColumns({ sort_keys: [{ column_index: 1, ascending: false }] });

		assert.deepStrictEqual(
			(await view.convertToCode({
				column_filters: [],
				row_filters: [],
				sort_keys: [],
				code_syntax_name: { code_syntax_name: 'SQL' },
			})).converted_code,
			// Only the ordering the user actually chose; the tiebreaker exists for Positron's own
			// paging and would be noise in code the user runs.
			['SELECT *', 'FROM "public"."actor"', 'ORDER BY "first_name" DESC']
		);
	});
});

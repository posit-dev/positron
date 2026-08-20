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
	ColumnProfileType,
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
	{ column_name: 'actor_id', column_type: 'int4', type_display: ColumnDisplayType.Integer, is_binary: false },
	{ column_name: 'first_name', column_type: 'varchar', type_display: ColumnDisplayType.String, is_binary: false },
];

/** A schema with a binary column, for the reads that must never fetch bytes. */
const BINARY_SCHEMA: OdbcSchemaEntry[] = [
	{ column_name: 'category_id', column_type: 'int2', type_display: ColumnDisplayType.Integer, is_binary: false },
	{ column_name: 'picture', column_type: 'bytea', type_display: ColumnDisplayType.Object, is_binary: true },
];

/**
 * A client that records the SQL it is asked to run and answers counts so construction settles.
 * @param options.rejectOctetLength Fails any query using the `{fn OCTET_LENGTH(...)}` escape, the
 * way a driver that does not implement it would, so the fallback can be exercised.
 * @param options.rows Overrides the row the client answers with.
 */
function createRecordingClient(options: { rejectOctetLength?: boolean; rows?: OdbcRow[] } = {}): IOdbcQueryClient & { queries: string[] } {
	const queries: string[] = [];
	return {
		queries,
		runQuery: async (sql: string): Promise<OdbcRow[]> => {
			queries.push(sql);
			if (options.rejectOctetLength && sql.includes('OCTET_LENGTH')) {
				throw new Error('[odbc] scalar function OCTET_LENGTH is not supported');
			}
			// Row counts are answered separately from data reads, so a test can supply its own data
			// rows without starving the view of the count it needs to think the table is non-empty.
			if (sql.includes('count(*) AS n')) {
				return [{ n: 3 }];
			}
			return options.rows ?? [{ c0: 1, c1: 'Penelope' }];
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

function createView(
	dialect: OdbcDialect,
	ref?: Partial<OdbcTableRef>,
	options: { schema?: OdbcSchemaEntry[]; client?: IOdbcQueryClient & { queries: string[] } } = {}
) {
	const client = options.client ?? createRecordingClient();
	const view = new OdbcTableView(
		client,
		{ schema: 'public', name: 'actor', kind: 'table', ...ref },
		dialect,
		options.schema ?? SCHEMA
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
				// These views are built without a resolved row identity, so the first column stands
				// in as the paging tiebreaker. Where SQLPrimaryKeys reports a key, its columns are
				// used instead -- see odbcPaging.test.ts.
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

	test('never selects a binary column\'s bytes, measuring it instead', async () => {
		// node-odbc materializes binary values with napi_create_external_arraybuffer, which Electron
		// refuses outright -- a fatal native error that kills the worker rather than an exception.
		// The bytes are only ever rendered as a size, so the size is all that is fetched.
		const { client, view } = createView(LIMIT_OFFSET, { name: 'categories' }, {
			schema: BINARY_SCHEMA,
			client: createRecordingClient({ rows: [{ c0: 1, c1: 11626 }] }),
		});

		const data = await view.getDataValues({
			columns: [
				{ column_index: 0, spec: { first_index: 0, last_index: 0 } },
				{ column_index: 1, spec: { first_index: 0, last_index: 0 } },
			],
			format_options: FORMAT_OPTIONS,
		});

		assert.deepStrictEqual(
			{ sql: lastQuery(client), values: data.columns },
			{
				sql: 'SELECT "category_id" AS c0, {fn OCTET_LENGTH("picture")} AS c1 FROM "public"."categories"\nORDER BY "category_id" LIMIT 1 OFFSET 0',
				values: [['1'], ['[BINARY 11626 bytes]']],
			}
		);
	});

	test('falls back to a presence check when the backend rejects the length escape', async () => {
		const { client, view } = createView(LIMIT_OFFSET, { name: 'categories' }, {
			schema: BINARY_SCHEMA,
			client: createRecordingClient({ rejectOctetLength: true, rows: [{ c0: 1 }] }),
		});

		const data = await view.getDataValues({
			columns: [{ column_index: 1, spec: { first_index: 0, last_index: 0 } }],
			format_options: FORMAT_OPTIONS,
		});

		assert.deepStrictEqual(
			{ sql: lastQuery(client), values: data.columns },
			{
				// Plain SQL every backend accepts: 0 for null, 1 for present.
				sql: 'SELECT CASE WHEN "picture" IS NULL THEN 0 ELSE 1 END AS c0 FROM "public"."categories"\nORDER BY "category_id" LIMIT 1 OFFSET 0',
				values: [['[BINARY]']],
			}
		);
	});

	test('reports an empty frequency table for a binary column without querying it', async () => {
		const { client, view } = createView(LIMIT_OFFSET, { name: 'categories' }, { schema: BINARY_SCHEMA });
		const before = client.queries.length;

		const profiles = await view.computeColumnProfiles({
			callback_id: 'cb',
			profiles: [{
				column_index: 1,
				profiles: [{ profile_type: ColumnProfileType.SmallFrequencyTable, params: { limit: 10 } }],
			}],
			format_options: FORMAT_OPTIONS,
		});

		assert.deepStrictEqual(
			{
				profile: profiles.profiles[0].small_frequency_table,
				// Grouping by a binary column would have to select the bytes as the group key.
				queriesIssued: client.queries.length - before,
			},
			{ profile: { values: [], counts: [], other_count: 3 }, queriesIssued: 0 }
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

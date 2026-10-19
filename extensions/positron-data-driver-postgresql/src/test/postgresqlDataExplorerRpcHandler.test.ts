/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as positron from 'positron';
import { BackendState, ColumnDisplayType, DataExplorerBackendRequest, FilterComparisonOp, RowFilter, RowFilterCondition, RowFilterType } from 'positron-data-explorer-protocol';
import { PostgresDataExplorerRpcHandler } from '../postgresqlDataExplorerRpcHandler.js';
import { IPostgresQueryClient } from '../postgresqlTableView.js';

/**
 * Answers the queries a view runs before any profile is requested: the schema lookup (one integer
 * column) and the row count. Returns undefined for anything else.
 */
function metadataRows(sql: string): Array<Record<string, unknown>> | undefined {
	if (/information_schema\.columns/.test(sql)) {
		return [{ column_name: 'duration', data_type: 'integer' }];
	}
	if (/count\(\*\) AS [`"]?n[`"]? FROM/.test(sql)) {
		return [{ n: 10 }];
	}
	return undefined;
}

function metadataClient(): IPostgresQueryClient {
	return { runQuery: async sql => metadataRows(sql) ?? [] };
}

function openTableView(handler: PostgresDataExplorerRpcHandler, client: IPostgresQueryClient) {
	return handler.openTableView('ds1', client, 'public', 'trips', 'table');
}

/**
 * Builds a handler whose registration is captured instead of sent to Positron, so a test can drive
 * the hooks Positron would call without replacing the running extension's provider.
 */
function createHandler() {
	let registered: positron.DataExplorerRpcHandler | undefined;
	const handler = new PostgresDataExplorerRpcHandler(undefined, (_providerId, rpcHandler) => {
		registered = rpcHandler;
		return { sendUiEvent: () => { }, dispose: () => { } };
	});
	return { handler, registered: () => registered };
}

/**
 * A table that changes outside Positron: its row count, and whether it still exists, can change
 * between reads. Its next schema lookup can be held, to act while a refresh is under way.
 */
function changingTable() {
	const table = {
		rows: 10,
		exists: true,
		queries: [] as string[],
		holdSchema: undefined as Promise<void> | undefined,
		/** Count queries containing this text fail, as a filter the database cannot evaluate does. */
		failOn: undefined as string | undefined,
		/** Filtered counts that read rows fail with this message, as one that times out does. */
		failFilteredCounts: undefined as string | undefined,
		/** Holds the next filtered count that reads rows, to act while it is under way. */
		holdFilteredCount: undefined as Promise<void> | undefined,
	};
	const client: IPostgresQueryClient = {
		runQuery: async sql => {
			table.queries.push(sql);
			if (/information_schema\.columns/.test(sql)) {
				const hold = table.holdSchema;
				table.holdSchema = undefined;
				await hold;
				return table.exists ? [{ column_name: 'duration', data_type: 'integer' }] : [];
			}
			if (/count\(\*\) AS [`"]?n[`"]? FROM/.test(sql)) {
				if (!table.exists) {
					throw new Error('relation does not exist');
				}
				if (table.failOn !== undefined && sql.includes(table.failOn)) {
					throw new Error(`no such column: ${table.failOn}`);
				}
				// A check planned with a constant-false predicate reads no rows.
				if (/WHERE/.test(sql) && !/WHERE 1 = 0/.test(sql)) {
					if (table.failFilteredCounts !== undefined) {
						throw new Error(table.failFilteredCounts);
					}
					const hold = table.holdFilteredCount;
					table.holdFilteredCount = undefined;
					await hold;
				}
				return [{ n: table.rows }];
			}
			return [];
		},
	};
	return { table, client };
}

/** A gate a test opens when it is ready. */
function gate() {
	let release = () => { };
	const promise = new Promise<void>(resolve => {
		release = resolve;
	});
	return { promise, release };
}

const GET_STATE = { method: DataExplorerBackendRequest.GetState, uri: 'ds1', params: {} };

/** Reads the dataset's row count through the registered hook. */
async function rowCount(handler: positron.DataExplorerRpcHandler | undefined) {
	const response = await handler?.handleRpc(GET_STATE);
	return (response?.result as BackendState | undefined)?.table_shape.num_rows;
}

/** A filter on the table's one column, marked invalid as Positron marks one whose column is gone. */
const INVALID_FILTER: RowFilter = {
	filter_id: 'filter-1',
	filter_type: RowFilterType.Compare,
	column_schema: { column_name: 'duration', column_index: 0, type_name: 'integer', type_display: ColumnDisplayType.Integer },
	condition: RowFilterCondition.And,
	params: { op: FilterComparisonOp.Eq, value: '1' },
	is_valid: false,
	error_message: 'Column was removed',
};

const GET_SCHEMA = { method: DataExplorerBackendRequest.GetSchema, uri: 'ds1', params: { column_indices: [] } };

suite('PostgreSQL Data Explorer RPC Handler', () => {
	test('closing a dataset through the registered hook drops its view until it is reopened', async () => {
		const { handler, registered } = createHandler();
		try {
			await openTableView(handler, metadataClient());
			const whileOpen = await registered()?.handleRpc(GET_SCHEMA);
			registered()?.closeDataset?.('ds1');
			const afterClose = await registered()?.handleRpc(GET_SCHEMA);
			await openTableView(handler, metadataClient());
			const afterReopen = await registered()?.handleRpc(GET_SCHEMA);
			assert.deepStrictEqual([whileOpen, afterClose, afterReopen], [
				{ result: { columns: [] } },
				{ error_message: 'No PostgreSQL data explorer is open for ds1' },
				{ result: { columns: [] } },
			]);
		} finally {
			handler.dispose();
		}
	});

	suite('refresh', () => {
		test('shows the rows added to the table since the view was built', async () => {
			const { handler, registered } = createHandler();
			const { table, client } = changingTable();
			try {
				await openTableView(handler, client);
				const before = await rowCount(registered());
				table.rows = 12;
				await registered()?.refreshDataset?.('ds1');
				assert.deepStrictEqual([before, await rowCount(registered())], [10, 12]);
			} finally {
				handler.dispose();
			}
		});

		test('keeps the existing view when the table can no longer be read', async () => {
			const { handler, registered } = createHandler();
			const { table, client } = changingTable();
			try {
				await openTableView(handler, client);
				table.exists = false;
				await assert.rejects(Promise.resolve(registered()?.refreshDataset?.('ds1')));
				assert.strictEqual(await rowCount(registered()), 10);
			} finally {
				handler.dispose();
			}
		});

		test('does not bring back a dataset that closed while it was refreshing', async () => {
			const { handler, registered } = createHandler();
			const { table, client } = changingTable();
			try {
				await openTableView(handler, client);
				const schemaLookup = gate();
				table.holdSchema = schemaLookup.promise;
				const refreshing = Promise.resolve(registered()?.refreshDataset?.('ds1'));
				registered()?.closeDataset?.('ds1');
				schemaLookup.release();
				await assert.rejects(refreshing);
				assert.deepStrictEqual(await registered()?.handleRpc(GET_STATE), {
					error_message: 'No PostgreSQL data explorer is open for ds1',
				});
			} finally {
				handler.dispose();
			}
		});

		test('discards a refresh overtaken by the dataset reopening', async () => {
			const { handler, registered } = createHandler();
			const { table, client } = changingTable();
			try {
				await openTableView(handler, client);
				const schemaLookup = gate();
				table.holdSchema = schemaLookup.promise;
				const refreshing = Promise.resolve(registered()?.refreshDataset?.('ds1'));
				table.rows = 20;
				await openTableView(handler, client);
				// Had the overtaken refresh been installed, it would report this count.
				table.rows = 30;
				schemaLookup.release();
				await assert.rejects(refreshing);
				assert.strictEqual(await rowCount(registered()), 20);
			} finally {
				handler.dispose();
			}
		});

		test('reports a filter marked invalid without applying it', async () => {
			const { handler, registered } = createHandler();
			const { table, client } = changingTable();
			try {
				await openTableView(handler, client);
				await registered()?.handleRpc({
					method: DataExplorerBackendRequest.SetRowFilters,
					uri: 'ds1',
					params: { filters: [INVALID_FILTER] },
				});
				const state = (await registered()?.handleRpc(GET_STATE))?.result as BackendState | undefined;
				assert.deepStrictEqual({
					filtered: table.queries.some(sql => /count\(\*\)/.test(sql) && /WHERE/.test(sql)),
					rowFilters: state?.row_filters,
					rows: state?.table_shape.num_rows,
				}, {
					filtered: false,
					rowFilters: [INVALID_FILTER],
					rows: 10,
				});
			} finally {
				handler.dispose();
			}
		});
	});

	suite('row filters', () => {
		/** A filter on the given column keeping rows equal to the value, as the filter bar sends it. */
		const filterOn = (value: string, columnName = 'duration'): RowFilter => ({
			filter_id: `filter-${value}`,
			filter_type: RowFilterType.Compare,
			column_schema: { column_name: columnName, column_index: 0, type_name: 'integer', type_display: ColumnDisplayType.Integer },
			condition: RowFilterCondition.And,
			params: { op: FilterComparisonOp.Eq, value },
		});

		const setRowFilters = (handler: positron.DataExplorerRpcHandler | undefined, filters: RowFilter[]) =>
			handler?.handleRpc({ method: DataExplorerBackendRequest.SetRowFilters, uri: 'ds1', params: { filters } });

		const rowFiltersOf = async (handler: positron.DataExplorerRpcHandler | undefined) =>
			((await handler?.handleRpc(GET_STATE))?.result as BackendState | undefined)?.row_filters;

		test('marks a filter on a column the view does not have invalid, though it arrives unmarked', async () => {
			const { handler, registered } = createHandler();
			const { table, client } = changingTable();
			try {
				await openTableView(handler, client);
				await setRowFilters(registered(), [filterOn('1', 'removed_column')]);
				assert.deepStrictEqual({
					filtered: table.queries.some(sql => /count\(\*\)/.test(sql) && /WHERE/.test(sql)),
					rowFilters: await rowFiltersOf(registered()),
				}, {
					filtered: false,
					rowFilters: [{ ...filterOn('1', 'removed_column'), is_valid: false, error_message: 'Column was removed' }],
				});
			} finally {
				handler.dispose();
			}
		});

		test('marks a filter that cannot be evaluated invalid, and applies the rest', async () => {
			const { handler, registered } = createHandler();
			const { table, client } = changingTable();
			try {
				await openTableView(handler, client);
				table.failOn = 'boom';
				const response = await setRowFilters(registered(), [filterOn('1'), filterOn('boom')]);
				assert.deepStrictEqual({
					response,
					rowFilters: await rowFiltersOf(registered()),
				}, {
					response: { result: { selected_num_rows: 10, had_errors: true } },
					rowFilters: [
						filterOn('1'),
						{ ...filterOn('boom'), is_valid: false, error_message: 'no such column: boom' },
					],
				});
			} finally {
				handler.dispose();
			}
		});

		test('reports a failure that no one filter causes, and keeps the filters it had', async () => {
			const { handler, registered } = createHandler();
			const { table, client } = changingTable();
			try {
				await openTableView(handler, client);
				await setRowFilters(registered(), [filterOn('1')]);
				table.failFilteredCounts = 'statement timeout';
				const response = await setRowFilters(registered(), [filterOn('1'), filterOn('2')]);
				table.failFilteredCounts = undefined;
				assert.deepStrictEqual({
					response,
					rowFilters: await rowFiltersOf(registered()),
				}, {
					response: { error_message: 'statement timeout' },
					rowFilters: [filterOn('1')],
				});
			} finally {
				handler.dispose();
			}
		});

		test('keeps the filters of a request that succeeds after a later one fails', async () => {
			const { handler, registered } = createHandler();
			const { table, client } = changingTable();
			try {
				await openTableView(handler, client);
				const count = gate();
				table.holdFilteredCount = count.promise;
				const slower = setRowFilters(registered(), [filterOn('1')]);
				await new Promise<void>(resolve => setTimeout(resolve, 10));
				table.exists = false;
				const later = await setRowFilters(registered(), [filterOn('1'), filterOn('2')]);
				table.exists = true;
				count.release();
				await slower;
				assert.deepStrictEqual({
					laterFailed: later?.error_message !== undefined,
					rowFilters: await rowFiltersOf(registered()),
				}, {
					laterFailed: true,
					rowFilters: [filterOn('1')],
				});
			} finally {
				handler.dispose();
			}
		});

		test('keeps the filters it had when the table cannot be read', async () => {
			const { handler, registered } = createHandler();
			const { table, client } = changingTable();
			try {
				await openTableView(handler, client);
				await setRowFilters(registered(), [filterOn('1')]);
				table.exists = false;
				const response = await setRowFilters(registered(), [filterOn('1'), filterOn('2')]);
				table.exists = true;
				assert.deepStrictEqual({
					failed: response?.error_message !== undefined,
					rowFilters: await rowFiltersOf(registered()),
					rows: await rowCount(registered()),
				}, {
					failed: true,
					rowFilters: [filterOn('1')],
					rows: 10,
				});
			} finally {
				handler.dispose();
			}
		});
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as positron from 'positron';
import { BackendState, ColumnDisplayType, ColumnProfileType, DataExplorerBackendRequest, DataExplorerRpc, FilterComparisonOp, RowFilter, RowFilterCondition, RowFilterType } from 'positron-data-explorer-protocol';
import { DatabricksDataExplorerRpcHandler } from '../databricksDataExplorerRpcHandler.js';
import { IDatabricksQueryClient } from '../databricksTableView.js';

/**
 * Answers the queries a view runs before any profile is requested: the schema lookup (one integer
 * column) and the row count. Returns undefined for anything else.
 */
function metadataRows(sql: string): Array<Record<string, unknown>> | undefined {
	if (/^DESCRIBE TABLE /.test(sql)) {
		return [{ col_name: 'duration', data_type: 'int' }];
	}
	if (/count\(\*\) AS [`"]?n[`"]? FROM/.test(sql)) {
		return [{ n: 10 }];
	}
	// A result-window read returns as many rows as the count.
	const window = / AS [`\"]?c0[`\"]?[\s\S]*(?:LIMIT|FETCH NEXT) (?<limit>\d+)/.exec(sql);
	if (window?.groups) {
		return Array.from({ length: Math.min(10, Number(window.groups.limit)) }, (_, i) => ({ c0: i }));
	}
	return undefined;
}

function metadataClient(): IDatabricksQueryClient {
	return { runQuery: async sql => metadataRows(sql) ?? [] };
}

function openTableView(handler: DatabricksDataExplorerRpcHandler, client: IDatabricksQueryClient) {
	return handler.openTableView('ds1', client, 'catalog', 'schema', 'trips', 'table');
}

/**
 * Builds a handler whose registration is captured instead of sent to Positron, so a test can drive
 * the hooks Positron would call without replacing the running extension's provider.
 */
function createHandler() {
	let registered: positron.DataExplorerRpcHandler | undefined;
	const handler = new DatabricksDataExplorerRpcHandler(undefined, (_providerId, rpcHandler) => {
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
	const client: IDatabricksQueryClient = {
		runQuery: async sql => {
			table.queries.push(sql);
			if (/^DESCRIBE TABLE /.test(sql)) {
				const hold = table.holdSchema;
				table.holdSchema = undefined;
				await hold;
				return table.exists ? [{ col_name: 'duration', data_type: 'int' }] : [];
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
			// A result-window read returns as many rows as the table holds.
			const window = / AS [`\"]?c0[`\"]?[\s\S]*(?:LIMIT|FETCH NEXT) (?<limit>\d+)/.exec(sql);
			if (window?.groups) {
				if (!table.exists) {
					throw new Error('relation does not exist');
				}
				return Array.from({ length: Math.min(table.rows, Number(window.groups.limit)) }, (_, i) => ({ c0: i }));
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

function columnProfilesRequest(callbackId: string): DataExplorerRpc {
	return {
		method: DataExplorerBackendRequest.GetColumnProfiles,
		uri: 'ds1',
		params: {
			callback_id: callbackId,
			profiles: [{ column_index: 0, profiles: [{ profile_type: ColumnProfileType.NullCount }] }],
			format_options: { large_num_digits: 2, small_num_digits: 4, max_integral_digits: 7, max_value_length: 100 },
		},
	};
}

/** Lets pending promise chains run, including the handler's profile drain loop. */
function settle() {
	return new Promise<void>(resolve => setTimeout(resolve, 10));
}

suite('Databricks Data Explorer RPC Handler', () => {
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
				{ error_message: 'No Databricks data explorer is open for ds1' },
				{ result: { columns: [] } },
			]);
		} finally {
			handler.dispose();
		}
	});

	test('a profile request made after the dataset closes and reopens runs on the reopened view', async () => {
		const { handler, registered } = createHandler();

		// The closed view's profile queries wait on a gate, so its pass is still running when the
		// dataset closes, reopens, and is asked for profiles again.
		let release = () => { };
		const gate = new Promise<void>(resolve => {
			release = resolve;
		});
		let released = false;
		const closedViewQueriesAfterRelease: string[] = [];
		const closedClient: IDatabricksQueryClient = {
			runQuery: async sql => {
				const rows = metadataRows(sql);
				if (rows) {
					return rows;
				}
				if (released) {
					closedViewQueriesAfterRelease.push(sql);
				}
				await gate;
				return [];
			},
		};
		const reopenedViewQueries: string[] = [];
		const reopenedClient: IDatabricksQueryClient = {
			runQuery: async sql => {
				const rows = metadataRows(sql);
				if (rows) {
					return rows;
				}
				reopenedViewQueries.push(sql);
				return [];
			},
		};

		try {
			await openTableView(handler, closedClient);
			await registered()?.handleRpc(columnProfilesRequest('first'));
			await settle();
			registered()?.closeDataset?.('ds1');
			await openTableView(handler, reopenedClient);
			await registered()?.handleRpc(columnProfilesRequest('second'));
			released = true;
			release();
			await settle();
			assert.deepStrictEqual({
				closedViewQueriedAfterRelease: closedViewQueriesAfterRelease.length > 0,
				reopenedViewQueried: reopenedViewQueries.length > 0,
			}, {
				closedViewQueriedAfterRelease: false,
				reopenedViewQueried: true,
			});
		} finally {
			release();
			handler.dispose();
		}
	});

	test('a profile request waiting when the dataset refreshes runs on the refreshed view', async () => {
		const events: positron.DataExplorerUiEvent[] = [];
		let registered: positron.DataExplorerRpcHandler | undefined;
		const handler = new DatabricksDataExplorerRpcHandler(undefined, (_providerId, rpcHandler) => {
			registered = rpcHandler;
			return { sendUiEvent: event => events.push(event), dispose: () => { } };
		});

		// The first pass's profile queries wait on a gate, so the second request is still waiting
		// for it when the dataset refreshes.
		const profileQueries = gate();
		let holdProfiles = true;
		const { client } = changingTable();
		const profilingClient: IDatabricksQueryClient = {
			runQuery: async sql => {
				const rows = await client.runQuery(sql);
				if (rows.length === 0 && holdProfiles) {
					await profileQueries.promise;
				}
				return rows;
			},
		};

		try {
			await openTableView(handler, profilingClient);
			await registered?.handleRpc(columnProfilesRequest('first'));
			await settle();
			await registered?.handleRpc(columnProfilesRequest('second'));
			await registered?.refreshDataset?.('ds1');
			holdProfiles = false;
			profileQueries.release();
			await settle();
			assert.ok(events.some(event => (event.params as { callback_id?: string }).callback_id === 'second'));
		} finally {
			profileQueries.release();
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
				// The Data Explorer reads the view's state as it opens, so the view holds its rows.
				await rowCount(registered());
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
					error_message: 'No Databricks data explorer is open for ds1',
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
				// The Data Explorer reads the reopened view's state as it opens, so the view holds 20 rows.
				await rowCount(registered());
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

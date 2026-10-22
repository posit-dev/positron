/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as positron from 'positron';
import { BackendState, ColumnDisplayType, DataExplorerBackendRequest, FilterComparisonOp, RowFilter, RowFilterCondition, RowFilterType } from 'positron-data-explorer-protocol';
import { SqliteDataExplorerRpcHandler } from '../sqliteDataExplorerRpcHandler.js';
import { ISqliteQueryClient } from '../sqliteWorkerClient.js';

/**
 * A view that changes outside Positron: its row count, and whether it still exists, can change
 * between reads. A view is read through a snapshot, so this also records the snapshots the handler
 * creates and drops. Its next schema lookup can be held, to act while a refresh is under way.
 */
function changingView() {
	const view = {
		rows: 10,
		exists: true,
		queries: [] as string[],
		created: [] as string[],
		dropped: [] as string[],
		holdSchema: undefined as Promise<void> | undefined,
		/** Count queries containing this text fail, as a filter the database cannot evaluate does. */
		failOn: undefined as string | undefined,
		/** Filtered counts that read rows fail with this message, as one that times out does. */
		failFilteredCounts: undefined as string | undefined,
		/** Holds the next filtered count that reads rows, to act while it is under way. */
		holdFilteredCount: undefined as Promise<void> | undefined,
	};
	const client: ISqliteQueryClient = {
		runQuery: async sql => {
			view.queries.push(sql);
			if (/^PRAGMA table_info\(/.test(sql)) {
				const hold = view.holdSchema;
				view.holdSchema = undefined;
				await hold;
				return view.exists ? [{ name: 'duration', type: 'INTEGER' }] : [];
			}
			const created = /^CREATE TEMP TABLE ("[^"]+")/.exec(sql);
			if (created) {
				if (!view.exists) {
					throw new Error('no such table: trips_view');
				}
				view.created.push(created[1]);
				return [];
			}
			const dropped = /^DROP TABLE IF EXISTS temp\.("[^"]+")/.exec(sql);
			if (dropped) {
				view.dropped.push(dropped[1]);
				return [];
			}
			if (/count\(\*\) AS n FROM/.test(sql)) {
				if (view.failOn !== undefined && sql.includes(view.failOn)) {
					throw new Error(`no such column: ${view.failOn}`);
				}
				// A check planned with a constant-false predicate reads no rows.
				if (/WHERE/.test(sql) && !/WHERE 1 = 0/.test(sql)) {
					if (view.failFilteredCounts !== undefined) {
						throw new Error(view.failFilteredCounts);
					}
					const hold = view.holdFilteredCount;
					view.holdFilteredCount = undefined;
					await hold;
				}
				return [{ n: view.rows }];
			}
			return [];
		},
	};
	return { view, client };
}

function openTableView(handler: SqliteDataExplorerRpcHandler, client: ISqliteQueryClient) {
	return handler.openTableView('ds1', client, 'trips_view', 'view');
}

/**
 * Builds a handler whose registration is captured instead of sent to Positron, so a test can drive
 * the hooks Positron would call without replacing the running extension's provider.
 */
function createHandler() {
	let registered: positron.DataExplorerRpcHandler | undefined;
	const handler = new SqliteDataExplorerRpcHandler(undefined, (_providerId, rpcHandler) => {
		registered = rpcHandler;
		return { sendUiEvent: () => { }, dispose: () => { } };
	});
	return { handler, registered: () => registered };
}

/** A gate a test opens when it is ready. */
function gate() {
	let release = () => { };
	const promise = new Promise<void>(resolve => {
		release = resolve;
	});
	return { promise, release };
}

/** Lets the handler's best-effort snapshot cleanup run. */
function settle() {
	return new Promise<void>(resolve => setTimeout(resolve, 10));
}

const GET_STATE = { method: DataExplorerBackendRequest.GetState, uri: 'ds1', params: {} };

/** Reads the dataset's row count through the registered hook. */
async function rowCount(handler: positron.DataExplorerRpcHandler | undefined) {
	const response = await handler?.handleRpc(GET_STATE);
	return (response?.result as BackendState | undefined)?.table_shape.num_rows;
}

/** A filter on the view's one column, marked invalid as Positron marks one whose column is gone. */
const INVALID_FILTER: RowFilter = {
	filter_id: 'filter-1',
	filter_type: RowFilterType.Compare,
	column_schema: { column_name: 'duration', column_index: 0, type_name: 'INTEGER', type_display: ColumnDisplayType.Integer },
	condition: RowFilterCondition.And,
	params: { op: FilterComparisonOp.Eq, value: '1' },
	is_valid: false,
	error_message: 'Column was removed',
};

suite('SQLite Data Explorer RPC Handler', () => {
	suite('refresh', () => {
		test('shows the rows added since the view was built, and drops the snapshot it replaces', async () => {
			const { handler, registered } = createHandler();
			const { view, client } = changingView();
			try {
				await openTableView(handler, client);
				const before = await rowCount(registered());
				view.rows = 12;
				await registered()?.refreshDataset?.('ds1');
				await settle();
				assert.deepStrictEqual({
					rows: [before, await rowCount(registered())],
					snapshots: view.created.length,
					dropped: view.dropped,
				}, {
					rows: [10, 12],
					snapshots: 2,
					dropped: [view.created[0]],
				});
			} finally {
				handler.dispose();
			}
		});

		test('keeps the existing view when the view can no longer be read', async () => {
			const { handler, registered } = createHandler();
			const { view, client } = changingView();
			try {
				await openTableView(handler, client);
				view.exists = false;
				await assert.rejects(Promise.resolve(registered()?.refreshDataset?.('ds1')));
				await settle();
				assert.deepStrictEqual({
					rows: await rowCount(registered()),
					dropped: view.dropped,
				}, {
					rows: 10,
					dropped: [],
				});
			} finally {
				handler.dispose();
			}
		});

		test('does not bring back a dataset that closed while it was refreshing', async () => {
			const { handler, registered } = createHandler();
			const { view, client } = changingView();
			try {
				await openTableView(handler, client);
				const schemaLookup = gate();
				view.holdSchema = schemaLookup.promise;
				const refreshing = Promise.resolve(registered()?.refreshDataset?.('ds1'));
				registered()?.closeDataset?.('ds1');
				schemaLookup.release();
				await assert.rejects(refreshing);
				await settle();
				assert.deepStrictEqual({
					response: await registered()?.handleRpc(GET_STATE),
					// Both the closed view's snapshot and the discarded rebuild's are dropped.
					dropped: [...view.dropped].sort(),
				}, {
					response: { error_message: 'No SQLite data explorer is open for ds1' },
					dropped: [...view.created].sort(),
				});
			} finally {
				handler.dispose();
			}
		});

		test('discards a refresh overtaken by the dataset reopening', async () => {
			const { handler, registered } = createHandler();
			const { view, client } = changingView();
			try {
				await openTableView(handler, client);
				const schemaLookup = gate();
				view.holdSchema = schemaLookup.promise;
				const refreshing = Promise.resolve(registered()?.refreshDataset?.('ds1'));
				view.rows = 20;
				await openTableView(handler, client);
				// Had the overtaken refresh been installed, it would report this count.
				view.rows = 30;
				schemaLookup.release();
				await assert.rejects(refreshing);
				assert.strictEqual(await rowCount(registered()), 20);
			} finally {
				handler.dispose();
			}
		});

		test('reports a filter marked invalid without applying it', async () => {
			const { handler, registered } = createHandler();
			const { view, client } = changingView();
			try {
				await openTableView(handler, client);
				await registered()?.handleRpc({
					method: DataExplorerBackendRequest.SetRowFilters,
					uri: 'ds1',
					params: { filters: [INVALID_FILTER] },
				});
				const state = (await registered()?.handleRpc(GET_STATE))?.result as BackendState | undefined;
				assert.deepStrictEqual({
					filtered: view.queries.some(sql => /count\(\*\)/.test(sql) && /WHERE/.test(sql)),
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
			column_schema: { column_name: columnName, column_index: 0, type_name: 'INTEGER', type_display: ColumnDisplayType.Integer },
			condition: RowFilterCondition.And,
			params: { op: FilterComparisonOp.Eq, value },
		});

		const setRowFilters = (handler: positron.DataExplorerRpcHandler | undefined, filters: RowFilter[]) =>
			handler?.handleRpc({ method: DataExplorerBackendRequest.SetRowFilters, uri: 'ds1', params: { filters } });

		const rowFiltersOf = async (handler: positron.DataExplorerRpcHandler | undefined) =>
			((await handler?.handleRpc(GET_STATE))?.result as BackendState | undefined)?.row_filters;

		test('marks a filter on a column the view does not have invalid, though it arrives unmarked', async () => {
			const { handler, registered } = createHandler();
			const { view, client } = changingView();
			try {
				await openTableView(handler, client);
				await setRowFilters(registered(), [filterOn('1', 'removed_column')]);
				assert.deepStrictEqual({
					filtered: view.queries.some(sql => /count\(\*\)/.test(sql) && /WHERE/.test(sql)),
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
			const { view, client } = changingView();
			try {
				await openTableView(handler, client);
				view.failOn = 'boom';
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
			const { view, client } = changingView();
			try {
				await openTableView(handler, client);
				await setRowFilters(registered(), [filterOn('1')]);
				view.failFilteredCounts = 'statement timeout';
				const response = await setRowFilters(registered(), [filterOn('1'), filterOn('2')]);
				view.failFilteredCounts = undefined;
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
			const { view, client } = changingView();
			try {
				await openTableView(handler, client);
				const count = gate();
				view.holdFilteredCount = count.promise;
				const slower = setRowFilters(registered(), [filterOn('1')]);
				await new Promise<void>(resolve => setTimeout(resolve, 10));
				view.failOn = 'count(*)';
				const later = await setRowFilters(registered(), [filterOn('1'), filterOn('2')]);
				view.failOn = undefined;
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
			const { view, client } = changingView();
			try {
				await openTableView(handler, client);
				await setRowFilters(registered(), [filterOn('1')]);
				view.failOn = 'count(*)';
				const response = await setRowFilters(registered(), [filterOn('1'), filterOn('2')]);
				view.failOn = undefined;
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

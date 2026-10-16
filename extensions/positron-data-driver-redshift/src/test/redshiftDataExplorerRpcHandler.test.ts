/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as positron from 'positron';
import { ColumnProfileType, DataExplorerBackendRequest, DataExplorerRpc } from 'positron-data-explorer-protocol';
import { RedshiftDataExplorerRpcHandler } from '../redshiftDataExplorerRpcHandler.js';
import { IRedshiftQueryClient } from '../redshiftTableView.js';

/**
 * Answers the queries a view runs before any profile is requested: the schema lookup (one integer
 * column) and the row count. Returns undefined for anything else.
 */
function metadataRows(sql: string): Array<Record<string, unknown>> | undefined {
	if (/SVV_ALL_COLUMNS/.test(sql)) {
		return [{ column_name: 'duration', data_type: 'integer' }];
	}
	if (/count\(\*\) AS [`"]?n[`"]? FROM/.test(sql)) {
		return [{ n: 10 }];
	}
	return undefined;
}

function metadataClient(): IRedshiftQueryClient {
	return { runQuery: async sql => metadataRows(sql) ?? [] };
}

function openTableView(handler: RedshiftDataExplorerRpcHandler, client: IRedshiftQueryClient) {
	return handler.openTableView('ds1', client, 'dev', 'public', 'trips', 'table');
}

/**
 * Builds a handler whose registration is captured instead of sent to Positron, so a test can drive
 * the hooks Positron would call without replacing the running extension's provider.
 */
function createHandler() {
	let registered: positron.DataExplorerRpcHandler | undefined;
	const handler = new RedshiftDataExplorerRpcHandler(undefined, (_providerId, rpcHandler) => {
		registered = rpcHandler;
		return { sendUiEvent: () => { }, dispose: () => { } };
	});
	return { handler, registered: () => registered };
}

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

suite('Redshift Data Explorer RPC Handler', () => {
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
				{ error_message: 'No Redshift data explorer is open for ds1' },
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
		const closedClient: IRedshiftQueryClient = {
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
		const reopenedClient: IRedshiftQueryClient = {
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
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as positron from 'positron';
import { DataExplorerBackendRequest } from 'positron-data-explorer-protocol';
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
});

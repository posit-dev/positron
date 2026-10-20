/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as positron from 'positron';
import { DataExplorerBackendRequest } from 'positron-data-explorer-protocol';
import { DEFAULT_DIALECT } from '../odbcDatabases.js';
import { OdbcTableRef } from '../odbcNodes.js';
import { OdbcDataExplorerRpcHandler } from '../odbcDataExplorerRpcHandler.js';
import { IOdbcQueryClient } from '../odbcWorkerClient.js';

/** A client for a table with one column and no primary key. */
function metadataClient(): IOdbcQueryClient {
	return {
		runQuery: async () => [],
		tables: async () => [],
		columns: async () => [{ COLUMN_NAME: 'duration', TYPE_NAME: 'INTEGER', DATA_TYPE: 4, ORDINAL_POSITION: 1 }],
		primaryKeys: async () => [],
	};
}

const TABLE: OdbcTableRef = { schema: 'dbo', name: 'trips', kind: 'table' };

function openTableView(handler: OdbcDataExplorerRpcHandler, client: IOdbcQueryClient) {
	return handler.openTableView('ds1', client, TABLE, DEFAULT_DIALECT);
}

/**
 * Builds a handler whose registration is captured instead of sent to Positron, so a test can drive
 * the hooks Positron would call without replacing the running extension's provider.
 */
function createHandler() {
	let registered: positron.DataExplorerRpcHandler | undefined;
	const handler = new OdbcDataExplorerRpcHandler(undefined, (_providerId, rpcHandler) => {
		registered = rpcHandler;
		return { sendUiEvent: () => { }, dispose: () => { } };
	});
	return { handler, registered: () => registered };
}

const GET_SCHEMA = { method: DataExplorerBackendRequest.GetSchema, uri: 'ds1', params: { column_indices: [] } };

suite('ODBC Data Explorer RPC Handler', () => {
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
				{ error_message: 'No ODBC data explorer is open for ds1' },
				{ result: { columns: [] } },
			]);
		} finally {
			handler.dispose();
		}
	});
});

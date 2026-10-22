/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { DuckDBWorkerClient, IDuckDBDataExplorerHost, WorkerOpenConfig } from 'positron-data-explorer-duckdb';
import { DUCKDB_DATA_EXPLORER_PROVIDER_ID } from './duckdbConnection.js';
import { createDatabasesGroupNode, IDuckDBPreviewHost } from './duckdbNodes.js';
import { classifyMotherDuckOpenError, motherduckPath, scrubToken } from './motherduckCode.js';

/** Monotonically increasing id so each connection's previewed datasets get a unique key. */
let nextConnectionId = 1;

/** Connection configuration passed from the driver. */
export interface MotherDuckConnectionConfig {
	/** The MotherDuck access token. Never logged or shown. */
	token: string;

	/** The database to open, or undefined for the account's default. */
	database: string | undefined;

	/** Whether to open in read-only mode. */
	readOnly: boolean;
}

/**
 * A live MotherDuck connection. It owns its own DuckDB worker (not the shared pool, since an `md:`
 * path is not a file and carries a token) and shows every attached database in its tree.
 */
export class MotherDuckConnection implements positron.DataConnection, IDuckDBPreviewHost {
	private _client: DuckDBWorkerClient | undefined;

	private readonly _connectionId = `md-${nextConnectionId++}`;

	// Dataset ids opened via the preview methods, so they can be released on disconnect.
	private readonly _openedDatasets = new Set<string>();

	// The configured token, trimmed once. Used for the worker config and every scrubToken call.
	private readonly _token: string;

	/**
	 * Constructor. Call connect() after constructing to open the database.
	 * @param _config The connection configuration.
	 * @param _dataExplorerHandler Hosts table views previewed in the Data Explorer.
	 * @param _logger Optional diagnostic log sink for connection lifecycle events.
	 * @param _createClient Creates the worker client; injectable for tests.
	 */
	constructor(
		private readonly _config: MotherDuckConnectionConfig,
		private readonly _dataExplorerHandler: IDuckDBDataExplorerHost,
		private readonly _logger?: positron.DataConnectionLogger,
		private readonly _createClient: (config: WorkerOpenConfig) => DuckDBWorkerClient = c => new DuckDBWorkerClient(c)
	) {
		this._token = _config.token.trim();
	}

	/** Opens the database in a dedicated worker. Rejects with a token-free message on failure. */
	async connect(): Promise<void> {
		// Without a token the MotherDuck extension opens a browser sign-in and blocks, so never open.
		if (this._token === '') {
			throw new Error(vscode.l10n.t('A MotherDuck access token is required.'));
		}
		const path = motherduckPath(this._config.database);
		const mode = this._config.readOnly ? 'read-only' : 'read-write';
		this._logger?.info(`Opening ${path} (${mode})`);

		const client = this._createClient({
			databasePath: path,
			readOnly: this._config.readOnly,
			motherduckToken: this._token,
		});

		try {
			// The worker reports open errors per-query, so probe here.
			await client.runQuery('SELECT 1');
			this._client = client;
		} catch (err: any) {
			client.dispose();
			const detail = scrubToken(err?.message ?? String(err), this._token);
			this._logger?.error(`Failed to open ${path}: ${detail}`);
			throw new Error(openFailureMessage(detail));
		}

		this._logger?.info(`Opened ${path}`);
	}

	/** Returns a single "Databases" group listing every attached database. */
	async getChildren(): Promise<positron.DataConnectionNode[]> {
		return [createDatabasesGroupNode(this._ensureConnected(), this)];
	}

	/** Opens the given table or view in the Data Explorer; returns its dataset id. */
	async previewObject(database: string | undefined, schemaName: string, tableName: string, kind: 'table' | 'view'): Promise<string> {
		const client = this._ensureConnected();
		const datasetId = `motherduck:${this._connectionId}:${kind}:${database ?? ''}.${schemaName}.${tableName}`;
		await this._dataExplorerHandler.openTableView(datasetId, client, database, schemaName, tableName, kind);
		this._openedDatasets.add(datasetId);
		await positron.dataExplorer.open({
			providerId: DUCKDB_DATA_EXPLORER_PROVIDER_ID,
			datasetId,
			displayName: tableName,
		});
		return datasetId;
	}

	/** Opens a single column of the given table or view as a one-column grid; returns its dataset id. */
	async previewColumn(database: string | undefined, schemaName: string, tableName: string, kind: 'table' | 'view', columnName: string): Promise<string> {
		const client = this._ensureConnected();
		const datasetId = `motherduck:${this._connectionId}:column:${database ?? ''}.${schemaName}.${tableName}.${columnName}`;
		await this._dataExplorerHandler.openColumnView(datasetId, client, database, schemaName, tableName, kind, columnName);
		this._openedDatasets.add(datasetId);
		await positron.dataExplorer.open({
			providerId: DUCKDB_DATA_EXPLORER_PROVIDER_ID,
			datasetId,
			displayName: `${tableName}.${columnName}`,
		});
		return datasetId;
	}

	/** Returns whether this connection was opened in read-only mode. */
	async isReadOnly(): Promise<boolean> {
		return this._config.readOnly;
	}

	/** Releases previewed table views and disposes the owned worker. Idempotent. */
	async disconnect(): Promise<void> {
		for (const datasetId of this._openedDatasets) {
			this._dataExplorerHandler.closeTableView(datasetId);
		}
		this._openedDatasets.clear();
		this._client?.dispose();
		this._client = undefined;
	}

	/** Checks whether the connection is still open and operational. */
	async isConnected(): Promise<boolean> {
		if (!this._client || !this._client.isAlive) {
			return false;
		}
		try {
			await this._client.runQuery('SELECT 1');
			return true;
		} catch {
			return false;
		}
	}

	// Returns the client, or throws if the connection has been disconnected.
	private _ensureConnected(): DuckDBWorkerClient {
		if (!this._client) {
			throw new Error(vscode.l10n.t('Database connection is closed'));
		}
		return this._client;
	}
}

/** Formats an open failure for display; `detail` must already be scrubbed of the token. */
function openFailureMessage(detail: string): string {
	switch (classifyMotherDuckOpenError(detail)) {
		case 'auth':
			return vscode.l10n.t('MotherDuck rejected the access token. Check that it is correct and has not expired. {0}', detail);
		case 'extensionDownload':
			return vscode.l10n.t('Could not install the MotherDuck extension for DuckDB. Check your network connection and try again. {0}', detail);
		default:
			return vscode.l10n.t('Failed to connect to MotherDuck. {0}', detail);
	}
}

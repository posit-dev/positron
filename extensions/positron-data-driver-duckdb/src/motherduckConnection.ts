/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { DuckDBRow, DuckDBWorkerClient, IDuckDBDataExplorerHost, IDuckDBQueryClient, WorkerOpenConfig } from 'positron-data-explorer-duckdb';
import { createDatabasesGroupNode, IDuckDBPreviewHost } from './duckdbNodes.js';
import { classifyMotherDuckOpenError, motherduckPath, scrubToken } from './motherduckCode.js';

/**
 * The Data Explorer provider id for MotherDuck previews. MotherDuck has its own RPC handler so
 * preview errors are logged to the MotherDuck output channel.
 */
export const MOTHERDUCK_DATA_EXPLORER_PROVIDER_ID = 'positron-data-driver-motherduck';

/**
 * How long connect() waits for MotherDuck to open before giving up. The first open also downloads
 * the MotherDuck extension (about 60 MB), so this allows for a slow network.
 */
const CONNECT_TIMEOUT_MS = 5 * 60_000;

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

	// Wraps _client for every tree and preview query, so their errors never carry the token.
	private _queryClient: IDuckDBQueryClient | undefined;

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
	 * @param _connectTimeoutMs How long connect() waits for the open; injectable for tests.
	 */
	constructor(
		private readonly _config: MotherDuckConnectionConfig,
		private readonly _dataExplorerHandler: IDuckDBDataExplorerHost,
		private readonly _logger?: positron.DataConnectionLogger,
		private readonly _createClient: (config: WorkerOpenConfig) => DuckDBWorkerClient = c => new DuckDBWorkerClient(c),
		private readonly _connectTimeoutMs = CONNECT_TIMEOUT_MS
	) {
		this._token = _config.token.trim();
	}

	/**
	 * Opens the database in a dedicated worker. Rejects with a token-free message on failure or
	 * when the open takes longer than the connect timeout. Does nothing if already connected.
	 *
	 * Only the driver calls this, once, before it returns the connection to core, so it cannot
	 * overlap another connect() or a disconnect().
	 */
	async connect(): Promise<void> {
		if (this._client) {
			return;
		}
		// Without a token the MotherDuck extension opens a browser sign-in and blocks, so never open.
		if (this._token === '') {
			throw new Error(accessTokenRequiredMessage());
		}
		const path = motherduckPath(this._config.database);
		const mode = this._config.readOnly ? 'read-only' : 'read-write';
		this._logger?.info(`Opening ${path} (${mode})`);

		const client = this._createClient({
			databasePath: path,
			readOnly: this._config.readOnly,
			motherduckToken: this._token,
		});

		let timer: ReturnType<typeof setTimeout> | undefined;
		let timedOut = false;
		const timeout = new Promise<never>((_resolve, reject) => {
			timer = setTimeout(() => {
				timedOut = true;
				reject(new Error('timed out'));
			}, this._connectTimeoutMs);
		});

		try {
			// The worker reports open errors per-query, so probe here.
			await Promise.race([client.runQuery('SELECT 1'), timeout]);
			this._client = client;
			this._queryClient = new TokenScrubbingClient(client, this._token);
		} catch (err: unknown) {
			client.dispose();
			if (timedOut) {
				this._logger?.error(`Timed out opening ${path} after ${this._connectTimeoutMs} ms`);
				throw new Error(vscode.l10n.t('Timed out connecting to MotherDuck. Check your network connection and try again.'));
			}
			const detail = scrubToken(err instanceof Error ? err.message : String(err), this._token);
			this._logger?.error(`Failed to open ${path}: ${detail}`);
			throw new Error(openFailureMessage(detail, path));
		} finally {
			clearTimeout(timer);
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
		// The names are JSON-encoded so names that contain dots cannot collide.
		const datasetId = `motherduck:${this._connectionId}:${kind}:${JSON.stringify([database, schemaName, tableName])}`;
		await this._dataExplorerHandler.openTableView(datasetId, client, database, schemaName, tableName, kind);
		this._openedDatasets.add(datasetId);
		await positron.dataExplorer.open({
			providerId: MOTHERDUCK_DATA_EXPLORER_PROVIDER_ID,
			datasetId,
			displayName: tableName,
		});
		return datasetId;
	}

	/** Opens a single column of the given table or view as a one-column grid; returns its dataset id. */
	async previewColumn(database: string | undefined, schemaName: string, tableName: string, kind: 'table' | 'view', columnName: string): Promise<string> {
		const client = this._ensureConnected();
		const datasetId = `motherduck:${this._connectionId}:column:${JSON.stringify([database, schemaName, tableName, columnName])}`;
		await this._dataExplorerHandler.openColumnView(datasetId, client, database, schemaName, tableName, kind, columnName);
		this._openedDatasets.add(datasetId);
		await positron.dataExplorer.open({
			providerId: MOTHERDUCK_DATA_EXPLORER_PROVIDER_ID,
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
		this._queryClient = undefined;
	}

	/**
	 * Checks whether the worker is alive and answers a query. DuckDB answers `SELECT 1` without
	 * contacting MotherDuck, which keeps status checks off the network; a lost MotherDuck session
	 * surfaces as an error on the next tree or preview query.
	 */
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

	// Returns the token-scrubbing client, or throws if the connection has been disconnected.
	private _ensureConnected(): IDuckDBQueryClient {
		if (!this._queryClient) {
			throw new Error(vscode.l10n.t('Database connection is closed'));
		}
		return this._queryClient;
	}
}

/** A query client that removes the access token from the message of every error it rethrows. */
class TokenScrubbingClient implements IDuckDBQueryClient {
	constructor(private readonly _client: DuckDBWorkerClient, private readonly _token: string) { }

	get onDidCrash(): vscode.Event<void> {
		return this._client.onDidCrash;
	}

	async runQuery(sql: string, params?: Record<string, string>): Promise<DuckDBRow[]> {
		try {
			return await this._client.runQuery(sql, params);
		} catch (err: unknown) {
			throw new Error(scrubToken(err instanceof Error ? err.message : String(err), this._token));
		}
	}
}

/** Formats an open failure for display; `detail` must already be scrubbed of the token. */
function openFailureMessage(detail: string, path: string): string {
	switch (classifyMotherDuckOpenError(detail)) {
		case 'databaseNotFound':
			return vscode.l10n.t("MotherDuck has no database named '{0}'. Check the default database name.", path.slice('md:'.length));
		case 'auth':
			return vscode.l10n.t('MotherDuck rejected the access token in the motherduck_token environment variable. Check that it is correct and has not expired, then restart Positron and reconnect. {0}', detail);
		case 'extensionDownload':
			return vscode.l10n.t('Could not install the MotherDuck extension for DuckDB. Check your network connection and try again. {0}', detail);
		default:
			return vscode.l10n.t('Failed to connect to MotherDuck. {0}', detail);
	}
}

/**
 * The message for a blank access token. The driver catches a missing `motherduck_token` first,
 * with its own message, so this guards direct callers of the connection.
 */
function accessTokenRequiredMessage(): string {
	return vscode.l10n.t('A MotherDuck access token is required.');
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import { SqliteError, SqliteWorkerClient } from './sqliteWorkerClient.js';
import { createRootNodes, ISqlitePreviewHost } from './sqliteNodes.js';
import { ISqliteDataExplorerHost, SQLITE_DATA_EXPLORER_PROVIDER_ID } from './sqliteDataExplorerRpcHandler.js';

/** Monotonically increasing id so each connection's previewed datasets get a unique key. */
let nextConnectionId = 1;

/**
 * Maps a worker-reported open/probe error to a user-facing message, preserving
 * the wording used before SQLite moved into a child process.
 */
function describeOpenError(err: SqliteError, databasePath: string): string {
	// Can't open error.
	if (err?.code === 'SQLITE_CANTOPEN' || err?.message?.includes('directory does not exist')) {
		return `Cannot open SQLite database: ${databasePath}. File does not exist or is not accessible.`;
	}

	// File is not a database error.
	if (err?.message?.includes('file is not a database')) {
		return `The file at ${databasePath} is not a valid SQLite database.`;
	}

	// Other errors.
	return `Failed to open SQLite database: ${err?.message ?? err}`;
}

/**
 * Returns just the first line of an error's message, for logging. Data Explorer queries inline the
 * user's filter and search values into SQL rather than binding parameters, and some engines append
 * the failing statement to their error message after the first line (verified for DuckDB); the first
 * line holds the diagnostic without the query text.
 */
function firstLineOf(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.split('\n')[0].trim();
}

/**
 * A live SQLite connection implementing the DataConnection interface.
 *
 * The native SQLite database runs in a separate child process via
 * SqliteWorkerClient, so a native failure (e.g. a corrupt database file or a
 * native abort) takes down only that child instead of the entire extension
 * host. This class is a thin host-side facade over the worker client; schema
 * browsing is provided via getChildren().
 */
export class SQLiteConnection implements positron.DataConnection, ISqlitePreviewHost {
	// The worker client, or undefined before connect()/after disconnect().
	private _client: SqliteWorkerClient | undefined;

	// Unique id for this connection, used to key its previewed datasets.
	private readonly _connectionId = `sqlite-${nextConnectionId++}`;

	// Dataset ids opened via previewObject(), so they can be released on disconnect.
	private readonly _openedDatasets = new Set<string>();

	/**
	 * Constructor. Call connect() after constructing to open the database.
	 * @param _databasePath Absolute path to the SQLite database file.
	 * @param _readOnly Whether to open the database in read-only mode.
	 * @param _dataExplorerHandler Hosts table views previewed in the Data Explorer.
	 * @param _logger Optional diagnostic log sink for connection lifecycle events.
	 */
	constructor(
		private readonly _databasePath: string,
		private readonly _readOnly: boolean,
		private readonly _dataExplorerHandler: ISqliteDataExplorerHost,
		private readonly _logger?: positron.DataConnectionLogger
	) { }

	/**
	 * Opens the database in the worker process. Must be called before any other
	 * method. Rejects with a descriptive error if the database cannot be opened
	 * (e.g. a missing file, or a file that is not a valid SQLite database).
	 */
	async connect(): Promise<void> {
		this._logger?.info(`Opening ${this._databasePath}${this._readOnly ? ' (read-only)' : ''}`);
		const client = new SqliteWorkerClient({ databasePath: this._databasePath, readOnly: this._readOnly });
		try {
			// Probe the connection so an open failure surfaces here rather than on
			// the first schema query. better-sqlite3 validates the file as a
			// database on first access, so this also catches "not a database".
			await client.runQuery('SELECT 1');
			this._client = client;
		} catch (err) {
			client.dispose();
			// Only the first line is logged: some engines echo the failing statement in their error
			// message after the first line (verified for DuckDB), and the probe here is a fixed
			// literal, but describeOpenError's message is not guaranteed to stay that way.
			this._logger?.error(`Failed to open ${this._databasePath}: ${firstLineOf(err)}`);
			throw new Error(describeOpenError(err as SqliteError, this._databasePath));
		}
		this._logger?.info(`Opened ${this._databasePath}`);
	}

	/**
	 * Returns top-level children: two category group nodes (Tables, Views). Each group defers its
	 * schema query until it is itself expanded.
	 */
	async getChildren(): Promise<positron.DataConnectionNode[]> {
		this._ensureConnected();
		return createRootNodes(this._client!, this);
	}

	/**
	 * Opens the given table or view in the Data Explorer. Registers a table view with the RPC
	 * handler under a stable per-connection dataset id, then asks Positron to open (or focus) the
	 * explorer backed by this extension's RPC command. Returns the dataset id it was opened under,
	 * which Positron uses to tell that this connection has a Data Explorer open on it.
	 */
	async previewObject(name: string, kind: 'table' | 'view'): Promise<string> {
		this._ensureConnected();
		const datasetId = `sqlite:${this._connectionId}:${kind}:${name}`;
		await this._dataExplorerHandler.openTableView(datasetId, this._client!, name, kind);
		this._openedDatasets.add(datasetId);
		await positron.dataExplorer.open({
			providerId: SQLITE_DATA_EXPLORER_PROVIDER_ID,
			datasetId,
			displayName: name,
		});
		return datasetId;
	}

	/**
	 * Opens a single column of the given table or view in the Data Explorer as a one-column grid.
	 * Uses a dataset id distinct from the table's so both can be open at once. Returns the dataset id
	 * it was opened under.
	 */
	async previewColumn(tableName: string, kind: 'table' | 'view', columnName: string): Promise<string> {
		this._ensureConnected();
		const datasetId = `sqlite:${this._connectionId}:column:${tableName}.${columnName}`;
		await this._dataExplorerHandler.openColumnView(datasetId, this._client!, tableName, kind, columnName);
		this._openedDatasets.add(datasetId);
		await positron.dataExplorer.open({
			providerId: SQLITE_DATA_EXPLORER_PROVIDER_ID,
			datasetId,
			displayName: `${tableName}.${columnName}`,
		});
		return datasetId;
	}

	/** Returns whether this connection was opened in read-only mode. */
	async isReadOnly(): Promise<boolean> {
		return this._readOnly;
	}

	/** Closes the database and releases any previewed table views. Idempotent. */
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
		// A crashed worker leaves the client present but not alive; don't respawn
		// just to answer this.
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

	// Throws if the database has been disconnected.
	private _ensureConnected(): void {
		if (!this._client) {
			throw new Error('Database connection is closed');
		}
	}
}

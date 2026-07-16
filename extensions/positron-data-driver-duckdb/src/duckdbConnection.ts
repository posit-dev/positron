/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import { duckDBWorkerPool, IDuckDBWorkerLease } from './duckdbWorkerPool.js';
import { createSchemasGroupNode, IDuckDBPreviewHost } from './duckdbNodes.js';
import { DUCKDB_DATA_EXPLORER_PROVIDER_ID, IDuckDBDataExplorerHost } from './duckdbDataExplorerRpcHandler.js';

/** Monotonically increasing id so each connection's previewed datasets get a unique key. */
let nextConnectionId = 1;

/**
 * Connection configuration passed from the driver.
 */
export interface DuckDBConnectionConfig {
	// Absolute path to the DuckDB database file.
	databasePath: string;

	// Whether to open the database in read-only mode.
	readOnly: boolean;
}

/**
 * A live DuckDB connection implementing the DataConnection interface.
 *
 * The native DuckDB database runs in a separate child process via
 * DuckDBWorkerClient, so a native failure (e.g. an out-of-memory abort) takes
 * down only that child instead of the entire extension host. This class is a
 * thin host-side facade over the worker client; schema browsing is provided via
 * getChildren().
 */
export class DuckDBConnection implements positron.DataConnection, IDuckDBPreviewHost {
	// The pooled worker lease, or undefined before connect()/after disconnect(). Connections to the
	// same database file share one worker via the pool, so releasing this lease closes the worker
	// only when it is the last one for that file.
	private _lease: IDuckDBWorkerLease | undefined;

	// Unique id for this connection, used to key its previewed datasets.
	private readonly _connectionId = `duckdb-${nextConnectionId++}`;

	// Dataset ids opened via the preview methods, so they can be released on disconnect.
	private readonly _openedDatasets = new Set<string>();

	/**
	 * Constructor. Call connect() after constructing to open the database.
	 * @param _config The connection configuration.
	 * @param _dataExplorerHandler Hosts table views previewed in the Data Explorer.
	 */
	constructor(
		private readonly _config: DuckDBConnectionConfig,
		private readonly _dataExplorerHandler: IDuckDBDataExplorerHost
	) { }

	/**
	 * Opens the database in the worker process. Must be called before any other
	 * method. Rejects if the database cannot be opened (e.g. a missing file in
	 * read-only mode).
	 */
	async connect(): Promise<void> {
		const databasePath = this._config.databasePath;
		if (!databasePath) {
			throw new Error('Database file path is required');
		}

		// Borrow a worker from the pool: connections to the same file + mode share one worker (and
		// therefore one file lock), so opening the same database twice reuses the existing worker
		// instead of spawning a second one that would fail to acquire the lock.
		const lease = duckDBWorkerPool.acquire({ databasePath, readOnly: this._config.readOnly });

		try {
			// Probe the connection so an open failure surfaces here rather than on
			// the first schema query. The worker reports open errors per-query.
			await lease.client.runQuery('SELECT 1');
			this._lease = lease;
		} catch (err: any) {
			// Release the lease so the worker is torn down if we were the only one holding it.
			lease.release();
			throw new Error(`Failed to open DuckDB database: ${databasePath}. ${err?.message ?? err}`);
		}
	}

	/**
	 * Returns top-level children: a single "Schemas" group node that lists every non-system
	 * schema. Each schema node can be expanded to show its Tables and Views groups.
	 */
	async getChildren(): Promise<positron.DataConnectionNode[]> {
		this._ensureConnected();
		return [createSchemasGroupNode(this._lease!.client, this)];
	}

	/**
	 * Opens the given table or view in the Data Explorer. Registers a table view with the RPC
	 * handler under a stable per-connection dataset id, then asks Positron to open (or focus) the
	 * explorer backed by this extension's provider.
	 */
	async previewObject(schemaName: string, tableName: string, kind: 'table' | 'view'): Promise<void> {
		this._ensureConnected();
		const datasetId = `duckdbconn:${this._connectionId}:${kind}:${schemaName}.${tableName}`;
		await this._dataExplorerHandler.openTableView(datasetId, this._lease!.client, schemaName, tableName, kind);
		this._openedDatasets.add(datasetId);
		await positron.dataExplorer.open({
			providerId: DUCKDB_DATA_EXPLORER_PROVIDER_ID,
			datasetId,
			displayName: tableName,
		});
	}

	/**
	 * Opens a single column of the given table or view in the Data Explorer as a one-column grid.
	 * Uses a dataset id distinct from the table's so both can be open at once.
	 */
	async previewColumn(schemaName: string, tableName: string, kind: 'table' | 'view', columnName: string): Promise<void> {
		this._ensureConnected();
		const datasetId = `duckdbconn:${this._connectionId}:column:${schemaName}.${tableName}.${columnName}`;
		await this._dataExplorerHandler.openColumnView(datasetId, this._lease!.client, schemaName, tableName, kind, columnName);
		this._openedDatasets.add(datasetId);
		await positron.dataExplorer.open({
			providerId: DUCKDB_DATA_EXPLORER_PROVIDER_ID,
			datasetId,
			displayName: `${tableName}.${columnName}`,
		});
	}

	/** Returns whether this connection was opened in read-only mode. */
	async isReadOnly(): Promise<boolean> {
		return this._config.readOnly;
	}

	/** Closes the database and releases any previewed table views. Idempotent. */
	async disconnect(): Promise<void> {
		for (const datasetId of this._openedDatasets) {
			this._dataExplorerHandler.closeTableView(datasetId);
		}
		this._openedDatasets.clear();
		// Release our lease rather than disposing directly: the pool closes the shared worker only
		// when the last connection to this file releases.
		this._lease?.release();
		this._lease = undefined;
	}

	/** Checks whether the connection is still open and operational. */
	async isConnected(): Promise<boolean> {
		// A crashed worker leaves the client present but not alive; don't respawn
		// just to answer this.
		if (!this._lease || !this._lease.client.isAlive) {
			return false;
		}
		try {
			await this._lease.client.runQuery('SELECT 1');
			return true;
		} catch {
			return false;
		}
	}

	// Throws if the database has been disconnected.
	private _ensureConnected(): void {
		if (!this._lease) {
			throw new Error('Database connection is closed');
		}
	}
}

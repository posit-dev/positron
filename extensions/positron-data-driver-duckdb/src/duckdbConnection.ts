/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import { DuckDBWorkerClient } from './duckdbWorkerClient.js';
import { createSchemasGroupNode } from './duckdbNodes.js';

/**
 * Connection configuration passed from the driver.
 */
export interface DuckDBConnectionConfig {
	// Absolute path to the DuckDB database file. Undefined for in-memory databases.
	databasePath?: string;

	// Whether to open the database in read-only mode (ignored for in-memory databases).
	readOnly: boolean;

	// Whether to open an in-memory database instead of a file.
	inMemory: boolean;
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
export class DuckDBConnection implements positron.DataConnection {
	// The worker client, or undefined before connect()/after disconnect().
	private _client: DuckDBWorkerClient | undefined;

	/**
	 * Constructor. Call connect() after constructing to open the database.
	 * @param _config The connection configuration.
	 */
	constructor(private readonly _config: DuckDBConnectionConfig) { }

	/**
	 * Opens the database in the worker process. Must be called before any other
	 * method. Rejects if the database cannot be opened (e.g. a missing file in
	 * read-only mode).
	 */
	async connect(): Promise<void> {
		// In-memory databases use the special ':memory:' path.
		const databasePath = this._config.inMemory ? ':memory:' : this._config.databasePath;
		if (!databasePath) {
			throw new Error('Database file path is required');
		}

		// In-memory databases are always read-write.
		const readOnly = this._config.readOnly && !this._config.inMemory;
		const client = new DuckDBWorkerClient({ databasePath, readOnly });

		try {
			// Probe the connection so an open failure surfaces here rather than on
			// the first schema query. The worker reports open errors per-query.
			await client.runQuery('SELECT 1');
			this._client = client;
		} catch (err: any) {
			client.dispose();
			const target = this._config.inMemory ? 'in-memory database' : databasePath;
			throw new Error(`Failed to open DuckDB database: ${target}. ${err?.message ?? err}`);
		}
	}

	/**
	 * Returns top-level children: a single "Schemas" group node that lists every non-system
	 * schema. Each schema node can be expanded to show its Tables and Views groups.
	 */
	async getChildren(): Promise<positron.DataConnectionNode[]> {
		this._ensureConnected();
		return [createSchemasGroupNode(this._client!)];
	}

	/** Returns whether this connection was opened in read-only mode. */
	async isReadOnly(): Promise<boolean> {
		// In-memory databases are always read-write.
		return this._config.readOnly && !this._config.inMemory;
	}

	/** Closes the database. Idempotent -- safe to call multiple times. */
	async disconnect(): Promise<void> {
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

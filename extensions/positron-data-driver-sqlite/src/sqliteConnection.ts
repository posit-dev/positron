/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import { SqliteError, SqliteWorkerClient } from './sqliteWorkerClient.js';
import { createRootNodes } from './sqliteNodes.js';

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
 * A live SQLite connection implementing the DataConnection interface.
 *
 * The native SQLite database runs in a separate child process via
 * SqliteWorkerClient, so a native failure (e.g. a corrupt database file or a
 * native abort) takes down only that child instead of the entire extension
 * host. This class is a thin host-side facade over the worker client; schema
 * browsing is provided via getChildren().
 */
export class SQLiteConnection implements positron.DataConnection {
	// The worker client, or undefined before connect()/after disconnect().
	private _client: SqliteWorkerClient | undefined;

	/**
	 * Constructor. Call connect() after constructing to open the database.
	 * @param _databasePath Absolute path to the SQLite database file.
	 * @param _readOnly Whether to open the database in read-only mode.
	 */
	constructor(
		private readonly _databasePath: string,
		private readonly _readOnly: boolean
	) { }

	/**
	 * Opens the database in the worker process. Must be called before any other
	 * method. Rejects with a descriptive error if the database cannot be opened
	 * (e.g. a missing file, or a file that is not a valid SQLite database).
	 */
	async connect(): Promise<void> {
		const client = new SqliteWorkerClient({ databasePath: this._databasePath, readOnly: this._readOnly });
		try {
			// Probe the connection so an open failure surfaces here rather than on
			// the first schema query. better-sqlite3 validates the file as a
			// database on first access, so this also catches "not a database".
			await client.runQuery('SELECT 1');
			this._client = client;
		} catch (err) {
			client.dispose();
			throw new Error(describeOpenError(err as SqliteError, this._databasePath));
		}
	}

	/**
	 * Returns top-level children: three category group nodes (Tables, Views, Indexes).
	 * Each group defers its schema query until it is itself expanded.
	 */
	async getChildren(): Promise<positron.DataConnectionNode[]> {
		this._ensureConnected();
		return createRootNodes(this._client!);
	}

	/** Returns whether this connection was opened in read-only mode. */
	async isReadOnly(): Promise<boolean> {
		return this._readOnly;
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

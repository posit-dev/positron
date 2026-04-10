/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import Database from 'better-sqlite3';
import { createTableNode, createViewNode } from './sqliteNodes.js';

/**
 * A live SQLite connection implementing the DataConnection interface.
 * Opens the database in the constructor and provides schema browsing
 * via getChildren().
 */
export class SQLiteConnection implements positron.DataConnection {
	// The open database handle, or null after disconnect.
	private _db: Database.Database | null;

	// Whether this connection was opened in read-only mode.
	private readonly _readOnly: boolean;

	/**
	 * Constructor.
	 * @param databasePath Absolute path to the SQLite database file.
	 * @param readOnly Whether to open the database in read-only mode.
	 */
	constructor(databasePath: string, readOnly: boolean) {
		try {
			// Open the database.
			this._db = new Database(databasePath, {
				readonly: readOnly,
				fileMustExist: true,
			});

			// Set the read only flag.
			this._readOnly = readOnly;
		} catch (err: any) {
			// Can't open error.
			if (err.code === 'SQLITE_CANTOPEN' || err.message?.includes('directory does not exist')) {
				throw new Error(`Cannot open SQLite database: ${databasePath}. File does not exist or is not accessible.`);
			}

			// File is not a database error.
			if (err.message?.includes('file is not a database')) {
				throw new Error(`The file at ${databasePath} is not a valid SQLite database.`);
			}

			// Other errors.
			throw new Error(`Failed to open SQLite database: ${err.message}`);
		}
	}

	/**
	 * Returns top-level children: user tables and views from sqlite_master.
	 * Internal sqlite_ tables are excluded.
	 */
	async getChildren(): Promise<positron.DataConnectionNode[]> {
		this._ensureConnected();

		// Prepare SQL to select user tables and views.
		const rows = this._db!.prepare(
			`SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name`
		).all() as Array<{ name: string; type: string }>;

		// Tables.
		const tables = rows
			.filter(row => row.type === 'table')
			.map(row => createTableNode(this._db!, row.name));

		// Views.
		const views = rows
			.filter(row => row.type === 'view')
			.map(row => createViewNode(this._db!, row.name));

		// Return the node.
		return [...tables, ...views];
	}

	/** Returns whether this connection was opened in read-only mode. */
	async isReadOnly(): Promise<boolean> {
		return this._readOnly;
	}

	/** Closes the database. Idempotent -- safe to call multiple times. */
	async disconnect(): Promise<void> {
		if (this._db) {
			this._db.close();
			this._db = null;
		}
	}

	/** Checks whether the database handle is still open and operational. */
	async isConnected(): Promise<boolean> {
		if (!this._db) {
			return false;
		}
		try {
			this._db.prepare('SELECT 1').get();
			return true;
		} catch {
			return false;
		}
	}

	// Throws if the database has been disconnected.
	private _ensureConnected(): void {
		if (!this._db) {
			throw new Error('Database connection is closed');
		}
	}
}

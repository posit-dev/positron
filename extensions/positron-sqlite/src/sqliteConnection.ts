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

	/**
	 * Constructor.
	 * @param databasePath Absolute path to the SQLite database file.
	 * @param readOnly Whether to open the database in read-only mode.
	 */
	constructor(databasePath: string, readOnly: boolean) {
		try {
			this._db = new Database(databasePath, {
				readonly: readOnly,
				fileMustExist: true,
			});
		} catch (err: any) {
			if (err.code === 'SQLITE_CANTOPEN' || err.message?.includes('directory does not exist')) {
				throw new Error(`Cannot open SQLite database: ${databasePath}. File does not exist or is not accessible.`);
			}
			if (err.message?.includes('file is not a database')) {
				throw new Error(`The file at ${databasePath} is not a valid SQLite database.`);
			}
			throw new Error(`Failed to open SQLite database: ${err.message}`);
		}
	}

	/**
	 * Returns top-level children: user tables and views from sqlite_master.
	 * Internal sqlite_ tables are excluded.
	 */
	async getChildren(): Promise<positron.DataConnectionNode[]> {
		this._ensureConnected();

		const rows = this._db!.prepare(
			`SELECT name, type FROM sqlite_masterZ
WHERE type IN ('table', 'view')
AND name NOT LIKE 'sqlite_%'
ORDER BY type, name`
		).all() as Array<{ name: string; type: string }>;

		return rows.map(row => {
			if (row.type === 'view') {
				return createViewNode(this._db!, row.name);
			}
			return createTableNode(this._db!, row.name);
		});
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

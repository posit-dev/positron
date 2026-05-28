/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import Database from 'better-sqlite3';
import {
	createGroupNode,
	createIndexNode,
	createTableNode,
	createTriggerNode,
	createViewNode,
} from './sqliteNodes.js';

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
	 * Returns top-level children: four category group nodes (Tables, Views, Indexes, Triggers).
	 * Each group defers its schema query until it is itself expanded.
	 */
	async getChildren(): Promise<positron.DataConnectionNode[]> {
		this._ensureConnected();

		return [
			createGroupNode('Tables', positron.DataConnectionNodeKind.GroupTables, () => this._listObjects('table').map(name => createTableNode(this._db!, name))),
			createGroupNode('Views', positron.DataConnectionNodeKind.GroupViews, () => this._listObjects('view').map(name => createViewNode(this._db!, name))),
			createGroupNode('Indexes', positron.DataConnectionNodeKind.GroupIndexes, () => this._listObjects('index').map(name => createIndexNode(this._db!, name))),
			createGroupNode('Triggers', positron.DataConnectionNodeKind.GroupTriggers, () => this._listObjects('trigger').map(name => createTriggerNode(name))),
		];
	}

	/**
	 * Lists object names of the given sqlite_master type ('table' | 'view' | 'index' | 'trigger'),
	 * excluding internal sqlite_-prefixed objects and auto-generated indexes (sqlite_autoindex_*
	 * is already covered by the sqlite_ filter).
	 */
	private _listObjects(type: 'table' | 'view' | 'index' | 'trigger'): string[] {
		this._ensureConnected();
		const rows = this._db!.prepare(
			`SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name`
		).all(type) as Array<{ name: string }>;
		return rows.map(row => row.name);
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

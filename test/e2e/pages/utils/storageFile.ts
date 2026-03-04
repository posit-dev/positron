/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import path from 'path';
import type { Database } from '@vscode/sqlite3';

const STORAGE_FILENAME = 'state.vscdb';

/**
 * Helper class to manage the Positron storage database (state.vscdb).
 * This is useful for pre-populating storage values in e2e tests to avoid
 * UI prompts or set specific state before the app starts.
 */
export class StorageFile {
	private readonly storagePath: string;

	/**
	 * Creates a new StorageFile instance.
	 * @param userDir The user data directory (e.g., userDataDir/User)
	 */
	constructor(userDir: string) {
		this.storagePath = path.join(userDir, 'globalStorage', STORAGE_FILENAME);
	}

	/**
	 * Checks if the storage database file exists.
	 */
	public async exists(): Promise<boolean> {
		try {
			await fs.access(this.storagePath);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Gets all storage values from the database.
	 * @returns A map of key-value pairs, or empty map if database doesn't exist
	 */
	public async getAll(): Promise<Map<string, string>> {
		const items = new Map<string, string>();

		if (!(await this.exists())) {
			return items;
		}

		const sqlite3 = await import('@vscode/sqlite3');

		return new Promise((resolve, reject) => {
			const db: Database = new sqlite3.default.Database(this.storagePath, (err) => {
				if (err) {
					reject(err);
					return;
				}

				db.all('SELECT key, value FROM ItemTable', (err, rows: Array<{ key: string; value: string }>) => {
					if (err) {
						db.close();
						// Only treat "no such table" as expected (empty DB), reject other errors
						if (err.message?.includes('no such table')) {
							resolve(items);
						} else {
							reject(err);
						}
						return;
					}

					if (rows) {
						for (const row of rows) {
							items.set(row.key, row.value);
						}
					}

					db.close((err) => {
						if (err) {
							reject(err);
						} else {
							resolve(items);
						}
					});
				});
			});
		});
	}

	/**
	 * Sets a storage value in the database.
	 * Creates the database and table if they don't exist.
	 * @param key The storage key
	 * @param value The value to store (will be converted to string)
	 * @param log Whether to dump raw DB contents after setting (default: false)
	 */
	public async set(key: string, value: string | boolean | number, log = false): Promise<void> {
		await this.setMultiple({ [key]: value });

		if (log) {
			await this.logContents();
		}
	}

	/**
	 * Sets multiple storage values at once using a single database connection.
	 * @param values An object containing key-value pairs to store
	 */
	public async setMultiple(values: Record<string, string | boolean | number>): Promise<void> {
		await fs.mkdir(path.dirname(this.storagePath), { recursive: true });

		const sqlite3 = await import('@vscode/sqlite3');
		const entries = Object.entries(values).map(([key, value]) => [
			key,
			typeof value === 'string' ? value : String(value)
		]);

		await new Promise<void>((resolve, reject) => {
			const db: Database = new sqlite3.default.Database(this.storagePath, (err) => {
				if (err) {
					reject(err);
					return;
				}

				db.serialize(() => {
					db.run('PRAGMA user_version = 1');
					db.run('CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)');

					const stmt = db.prepare('INSERT INTO ItemTable (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
					let insertError: Error | null = null;
					for (const [key, value] of entries) {
						stmt.run(key, value, (err: Error | null) => {
							if (err && !insertError) {
								insertError = err; // Capture first error
							}
						});
					}
					stmt.finalize((err) => {
						const finalError = err || insertError;
						if (finalError) {
							db.close();
							reject(finalError);
							return;
						}
						db.close((err) => {
							if (err) {
								reject(err);
							} else {
								resolve();
							}
						});
					});
				});
			});
		});
	}

	/**
	 * Logs the raw database contents for debugging using the sqlite3 library.
	 */
	private async logContents(): Promise<void> {
		try {
			const items = await this.getAll();
			const lines = Array.from(items.entries()).map(([k, v]) => `${k}|${v}`).join('\n');
			console.log(`[StorageFile] ${this.storagePath}:\n${lines}`);
		} catch (err) {
			console.log(`[StorageFile] Error reading file: ${err}`);
		}
	}
}

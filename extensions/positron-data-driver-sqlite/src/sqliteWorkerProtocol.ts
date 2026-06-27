/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Message shapes exchanged between the extension host and the SQLite child
// process (see `sqliteWorker.ts`). Messages are sent with Node's "advanced"
// (V8 structured clone) serialization, so values may include bigint and Buffer.

/**
 * Worker open configuration. Passed to the child process via fork argv (JSON
 * encoded) so the worker can open the database the moment it starts.
 */
export interface WorkerOpenConfig {
	/** Absolute path to the SQLite database file. */
	databasePath: string;

	/** Whether to open the database in read-only mode. */
	readOnly: boolean;
}

/** A value that can be bound to a positional (`?`) SQL parameter. */
export type SqliteBindValue = string | number | bigint | Buffer | null;

/** Host -> worker: run a SQL query identified by `id`, with optional positional parameters. */
export interface WorkerQueryRequest {
	id: number;
	sql: string;
	/** Positional parameters bound to `?` placeholders in the SQL, in order. */
	params?: SqliteBindValue[];
}

/** Worker -> host: the result (or error) for the query with the matching `id`. */
export type WorkerQueryResponse =
	| {
		kind: 'result';
		id: number;
		/** Materialized rows, one plain object per row keyed by column name. */
		rows: Array<Record<string, unknown>>;
	}
	| {
		kind: 'error';
		id: number;
		/** Human-readable error message from SQLite or the worker. */
		error: string;
		/** The better-sqlite3 / SQLite error code, if any (e.g. 'SQLITE_CANTOPEN'). */
		code?: string;
	};

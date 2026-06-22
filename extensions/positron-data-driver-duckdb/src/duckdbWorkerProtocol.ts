/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Message shapes exchanged between the extension host and the DuckDB child
// process (see `duckdbWorker.ts`). Messages are sent with Node's "advanced"
// (V8 structured clone) serialization, so values may include bigint and Date.

/**
 * Worker open configuration. Passed to the child process via fork argv (JSON
 * encoded) so the worker can open the database the moment it starts.
 */
export interface WorkerOpenConfig {
	/** Absolute path to the database file. */
	databasePath: string;

	/** Whether to open the database in read-only mode. */
	readOnly: boolean;
}

/** Host -> worker: run a SQL query identified by `id`, with optional named parameters. */
export interface WorkerQueryRequest {
	id: number;
	sql: string;
	/** Named parameters bound to `$name` placeholders in the SQL. */
	params?: Record<string, string>;
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
		/** Human-readable error message from DuckDB or the worker. */
		error: string;
	};

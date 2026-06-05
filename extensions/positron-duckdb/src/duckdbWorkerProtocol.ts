/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Message shapes exchanged between the extension host and the DuckDB child
// process (see `duckdbWorker.ts`). Messages are sent with Node's "advanced"
// (V8 structured clone) serialization, so values may include bigint and Date.

/** Host -> worker: run a SQL query identified by `id`. */
export interface WorkerQueryRequest {
	id: number;
	sql: string;
}

/** Worker -> host: the result (or error) for the query with the matching `id`. */
export type WorkerQueryResponse =
	| {
		kind: 'result';
		id: number;
		/** Column names in column order. */
		columnNames: string[];
		/** Materialized result, as one array of values per column. */
		columns: any[][];
	}
	| {
		kind: 'error';
		id: number;
		/** Human-readable error message from DuckDB or the worker. */
		error: string;
	};

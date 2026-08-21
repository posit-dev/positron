/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// This module is the entry point for the DuckDB child process. It owns the
// native `@duckdb/node-api` instance and runs queries on its behalf. Running
// DuckDB out-of-process isolates the extension host from native failures: a
// query that exhausts memory aborts (or is OS-killed) only this child, and the
// host can detect the exit, fail the in-flight request, and respawn. A native
// abort cannot be caught in-process, so this isolation is the only way to keep
// the extension host stable when DuckDB runs out of memory.

import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import {
	WorkerOpenConfig,
	WorkerQueryRequest,
	WorkerQueryResponse
} from './duckdbWorkerProtocol';

/** Send a response to the host, narrowed so TypeScript knows IPC is available. */
function send(response: WorkerQueryResponse): void {
	process.send?.(response);
}

// The open configuration is supplied by the host as the first fork argument
// (JSON encoded), so we can open the database immediately on startup.
const config: WorkerOpenConfig = JSON.parse(process.argv[2] ?? '{}');

let connection: DuckDBConnection | undefined;
let initError: Error | undefined;

// Open the database once. Failures (e.g. a missing read-only file, or a native
// binding that fails to load) are captured and reported per-query rather than
// crashing, so the host can surface a clean error from connect().
const ready: Promise<void> = (async () => {
	try {
		const options: Record<string, string> = {
			// The Data Explorer pages with a fresh LIMIT/OFFSET statement per page and states no
			// ORDER BY unless the user sorts, so its correctness rests on DuckDB returning a relation
			// in the same order every time. That is exactly what preserve_insertion_order buys, and
			// it is DuckDB's default -- but leaving it implicit means a future default change, or a
			// stray SET, would silently start duplicating and dropping rows as the user scrolls.
			// Measured with it off: a 2,000-page sweep of a 2M-row table repeated 751,752 rows and
			// missed 751,752 others. Stating it here makes the dependency explicit and pins it.
			preserve_insertion_order: 'true',
		};
		if (config.readOnly) {
			options.access_mode = 'READ_ONLY';
		}
		const instance = await DuckDBInstance.create(config.databasePath, options);
		connection = await instance.connect();
	} catch (error) {
		initError = error instanceof Error ? error : new Error(String(error));
	}
})();

// Process queries strictly in the order received. The native connection is not
// safe for concurrent `runAndReadAll` calls, so we chain them. The async body
// always replies and never rejects, so the chain cannot break.
let queue: Promise<void> = Promise.resolve();

process.on('message', (request: WorkerQueryRequest) => {
	queue = queue.then(async () => {
		await ready;
		if (initError || !connection) {
			send({ kind: 'error', id: request.id, error: (initError ?? new Error('DuckDB failed to initialize')).message });
			return;
		}
		try {
			const reader = await connection.runAndReadAll(request.sql, request.params);
			// Materialize to plain JS up front so the result can cross the IPC
			// boundary. `getRowObjectsJS` coerces values to plain JS (Date, number,
			// bigint, string, null), all of which the host receives via V8
			// "advanced" serialization.
			send({ kind: 'result', id: request.id, rows: reader.getRowObjectsJS() });
		} catch (error) {
			send({ kind: 'error', id: request.id, error: error instanceof Error ? error.message : String(error) });
		}
	});
});

// If the host goes away, there is nothing left to serve; exit cleanly.
process.on('disconnect', () => process.exit(0));

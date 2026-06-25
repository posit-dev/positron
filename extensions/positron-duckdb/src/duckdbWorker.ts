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
	WorkerQueryRequest,
	WorkerQueryResponse
} from './duckdbWorkerProtocol';

/** Send a response to the host, narrowed so TypeScript knows IPC is available. */
function send(response: WorkerQueryResponse): void {
	process.send?.(response);
}

let connection: DuckDBConnection | undefined;
let initError: Error | undefined;

// Initialize the native database once. Failures (e.g. a native binding that
// fails to load) are captured and reported per-query rather than crashing.
const ready: Promise<void> = (async () => {
	try {
		// On macOS the bundled `excel` extension is Apple code-signed, which
		// rewrites its Mach-O image; DuckDB's own signature (computed over the
		// original image) no longer matches, so we must allow loading unsigned
		// extensions. (The extension ships with DuckDB's footer stripped so it can
		// be signed, then reconstructed at runtime; see install-excel-extension.ts
		// and resolveExcelExtensionPath in extension.ts.) Trust comes instead from
		// the OS code signature, the SHA-256 pinned at install time, and the fact
		// that we only ever LOAD our own vendored extension by path. On
		// Linux/Windows the extension keeps DuckDB's signature, so we leave the
		// check in place rather than loosening it.
		const config = process.platform === 'darwin' ? { allow_unsigned_extensions: 'true' } : {};
		const instance = await DuckDBInstance.create(':memory:', config);
		connection = await instance.connect();
		await connection.run(`LOAD icu;
		SET TIMEZONE='UTC';
		`);
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
			const reader = await connection.runAndReadAll(request.sql);
			// Materialize to plain JS up front so the result can cross the IPC
			// boundary. `getColumnsJS` coerces values to plain JS (Date, number,
			// bigint, string, null), all of which the host receives via V8
			// "advanced" serialization.
			send({
				kind: 'result',
				id: request.id,
				columnNames: reader.columnNames(),
				columns: reader.getColumnsJS()
			});
		} catch (error) {
			send({ kind: 'error', id: request.id, error: error instanceof Error ? error.message : String(error) });
		}
	});
});

// If the host goes away, there is nothing left to serve; exit cleanly.
process.on('disconnect', () => process.exit(0));

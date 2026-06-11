/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// This module is the entry point for the SQLite child process. It owns the
// native `better-sqlite3` handle and runs queries on its behalf. Running SQLite
// out-of-process isolates the extension host from native failures: a corrupt
// database file or a native abort can crash (or be OS-killed) only this child,
// and the host can detect the exit, fail the in-flight request, and respawn. A
// native abort cannot be caught in-process, so this isolation is the only way
// to keep the extension host stable when the native binding fails.

import Database from 'better-sqlite3';
import {
	WorkerOpenConfig,
	WorkerQueryRequest,
	WorkerQueryResponse
} from './sqliteWorkerProtocol';

/** Send a response to the host, narrowed so TypeScript knows IPC is available. */
function send(response: WorkerQueryResponse): void {
	process.send?.(response);
}

// The open configuration is supplied by the host as the first fork argument
// (JSON encoded), so we can open the database immediately on startup.
const config: WorkerOpenConfig = JSON.parse(process.argv[2] ?? '{}');

let db: Database.Database | undefined;
let initError: { message: string; code?: string } | undefined;

// Open the database once. Failures (e.g. a missing file, or a native binding
// that fails to load) are captured and reported per-query, so the host can
// surface a clean error from connect(). Note that better-sqlite3 opens the file
// handle eagerly here but only validates the file as a database on first query,
// so a "file is not a database" error surfaces from the query handler below.
try {
	db = new Database(config.databasePath, { readonly: config.readOnly, fileMustExist: true });
} catch (error) {
	const err = error as NodeJS.ErrnoException;
	initError = { message: err?.message ?? String(error), code: err?.code };
}

// better-sqlite3 is synchronous, so each message is handled to completion before
// the next is processed -- no queue is needed.
process.on('message', (request: WorkerQueryRequest) => {
	if (initError || !db) {
		send({ kind: 'error', id: request.id, error: initError?.message ?? 'SQLite failed to initialize', code: initError?.code });
		return;
	}
	try {
		const rows = db.prepare(request.sql).all(...(request.params ?? [])) as Array<Record<string, unknown>>;
		send({ kind: 'result', id: request.id, rows });
	} catch (error) {
		const err = error as NodeJS.ErrnoException;
		send({ kind: 'error', id: request.id, error: err?.message ?? String(error), code: err?.code });
	}
});

// If the host goes away, there is nothing left to serve; exit cleanly.
process.on('disconnect', () => process.exit(0));

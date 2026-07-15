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
import * as path from 'node:path';
import {
	WorkerOpenConfig,
	WorkerQueryRequest,
	WorkerQueryResponse
} from './sqliteWorkerProtocol';

/**
 * Resolves the native binding better-sqlite3 should load for the current runtime.
 *
 * The default `better_sqlite3.node` is compiled for Electron's ABI, which is
 * correct for the desktop extension host (and the ELECTRON_RUN_AS_NODE worker it
 * forks). The server/remote extension host instead runs under plain Node.js,
 * whose ABI differs -- loading the Electron binary there fails with a
 * NODE_MODULE_VERSION mismatch. `build/npm/postinstall.ts` ships a Node-ABI build
 * alongside the default one (`better_sqlite3-node.node`); select it when we are
 * not running under Electron. Returning undefined lets better-sqlite3 fall back
 * to its default resolution (undefined is treated as "unset" by the constructor).
 */
function resolveNativeBinding(): string | undefined {
	if (process.versions.electron) {
		return undefined;
	}
	const packageJsonPath = require.resolve('better-sqlite3/package.json');
	return path.join(path.dirname(packageJsonPath), 'build', 'Release', 'better_sqlite3-node.node');
}

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
	db = new Database(config.databasePath, { readonly: config.readOnly, fileMustExist: true, nativeBinding: resolveNativeBinding() });
	registerRegexpFunctions(db);
} catch (error) {
	const err = error as NodeJS.ErrnoException;
	initError = { message: err?.message ?? String(error), code: err?.code };
}

/**
 * Registers regex helper functions used by Data Explorer row filters, since SQLite has no built-in
 * regex support. `regexp` backs the `x REGEXP y` operator (case-sensitive); `regexpi` is the
 * case-insensitive variant. Compiled patterns are cached so a filtered scan does not recompile per
 * row, and an invalid pattern simply matches nothing rather than throwing.
 */
function registerRegexpFunctions(database: Database.Database): void {
	const cache = new Map<string, RegExp | undefined>();
	const compile = (pattern: string, flags: string): RegExp | undefined => {
		const key = `${flags} ${pattern}`;
		if (!cache.has(key)) {
			try {
				cache.set(key, new RegExp(pattern, flags));
			} catch {
				cache.set(key, undefined);
			}
		}
		return cache.get(key);
	};
	const test = (pattern: unknown, value: unknown, flags: string): number => {
		if (value === null || value === undefined || typeof pattern !== 'string') {
			return 0;
		}
		const regex = compile(pattern, flags);
		return regex && regex.test(String(value)) ? 1 : 0;
	};
	// The REGEXP operator invokes regexp(pattern, value) with the operands in that order.
	database.function('regexp', (pattern: unknown, value: unknown) => test(pattern, value, ''));
	database.function('regexpi', (pattern: unknown, value: unknown) => test(pattern, value, 'i'));
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

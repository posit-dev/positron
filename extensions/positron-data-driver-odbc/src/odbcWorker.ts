/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// This module is the entry point for the ODBC child process. It owns the native `odbc` connection
// and runs requests on its behalf.
//
// Running ODBC out-of-process is not a nicety. An ODBC connection loads a third-party vendor
// library into the process and calls into it; the quality of those libraries varies, and a bad one
// segfaults or calls abort(). Neither can be caught in-process, so isolating them in a child that
// the host can watch die and respawn is the only way to keep the extension host stable. This is
// the same reasoning as positron-data-driver-sqlite's worker, with more cause.

import type { Connection } from 'odbc';
import {
	OdbcErrorDetail,
	OdbcRow,
	WorkerConnectConfig,
	WorkerRequest,
	WorkerResponse
} from './odbcWorkerProtocol';

/** Send a response to the host, narrowed so TypeScript knows IPC is available. */
function send(response: WorkerResponse): void {
	process.send?.(response);
}

// The connect configuration is supplied by the host as the first fork argument (JSON encoded).
const config: WorkerConnectConfig = JSON.parse(process.argv[2] ?? '{}');

/**
 * Loads the native binding. Phase-0 spike confirmed the published `napi-v8` binary is Node-API and
 * loads unchanged under both Electron (the desktop worker, forked with ELECTRON_RUN_AS_NODE) and
 * plain Node (the server extension host), so unlike better-sqlite3 there is no ABI-specific binary
 * to select here.
 *
 * The failure that does need distinguishing is the driver manager being absent: on macOS and Linux
 * the binding links against unixODBC's libodbc, and a machine without it fails at dlopen with a
 * message the user cannot act on. That is reported separately so the host can offer install
 * guidance rather than a stack trace.
 */
type LoadResult =
	| { kind: 'loaded'; odbc: typeof import('odbc') }
	| { kind: 'failed'; message: string };

function loadOdbc(): LoadResult {
	try {
		return { kind: 'loaded', odbc: require('odbc') };
	} catch (error) {
		return { kind: 'failed', message: error instanceof Error ? error.message : String(error) };
	}
}

const loaded = loadOdbc();

/**
 * Whether a load failure looks like a missing unixODBC rather than a broken install of our own
 * binding. dlopen reports the library it could not find, so the libodbc mention is the signal.
 */
function isDriverManagerMissing(message: string): boolean {
	return /libodbc/i.test(message) || /odbc32/i.test(message);
}

/** Flattens node-odbc's diagnostic records into one message, falling back to the Error's own. */
function describeError(error: unknown): { message: string; odbcErrors?: OdbcErrorDetail[] } {
	const odbcErrors = (error as { odbcErrors?: OdbcErrorDetail[] })?.odbcErrors;
	if (Array.isArray(odbcErrors) && odbcErrors.length > 0) {
		const message = odbcErrors
			.map(diagnostic => diagnostic.message?.trim())
			.filter((text): text is string => !!text)
			.join('; ');
		if (message.length > 0) {
			return { message, odbcErrors };
		}
	}
	return { message: error instanceof Error ? error.message : String(error), odbcErrors };
}

let connection: Connection | undefined;
let connecting: Promise<Connection> | undefined;

/**
 * Opens the connection, at most once. Held as a promise so requests that arrive while the connect
 * is still in flight await the same attempt rather than opening a second connection.
 */
function ensureConnected(): Promise<Connection> {
	if (connection !== undefined) {
		return Promise.resolve(connection);
	}
	if (connecting === undefined) {
		if (loaded.kind === 'failed') {
			return Promise.reject(new Error(loaded.message));
		}
		connecting = loaded.odbc
			.connect({
				connectionString: config.connectionString,
				connectionTimeout: config.connectionTimeout,
				loginTimeout: config.loginTimeout,
			})
			.then(opened => {
				connection = opened;
				return opened;
			})
			.catch(error => {
				// Allow a later request to retry rather than latching the first failure forever.
				connecting = undefined;
				throw error;
			});
	}
	return connecting;
}

/** Runs one request against the connection. */
async function handle(request: WorkerRequest): Promise<OdbcRow[]> {
	if (request.kind === 'close') {
		const open = connection;
		connection = undefined;
		connecting = undefined;
		await open?.close();
		return [];
	}

	const conn = await ensureConnected();

	switch (request.kind) {
		case 'ping':
			return [];
		case 'query':
			// node-odbc types the bind array as (string | number)[], but the driver manager accepts
			// a null bind for a nullable parameter, which the protocol allows and the types do not.
			return (await conn.query(request.sql, (request.params ?? []) as (string | number)[])) as unknown as OdbcRow[];
		case 'tables':
			return (await conn.tables(request.catalog, request.schema, request.table, request.type)) as unknown as OdbcRow[];
		case 'columns':
			return (await conn.columns(request.catalog, request.schema, request.table, request.column)) as unknown as OdbcRow[];
		case 'primaryKeys':
			return (await conn.primaryKeys(request.catalog, request.schema, request.table)) as unknown as OdbcRow[];
	}
}

// Requests are serialized onto a single chain. Driving one ODBC connection handle from several
// statements concurrently is not safe in general, and what a driver does when you try is
// vendor-specific, so the worker never has more than one request in flight.
let queue: Promise<void> = Promise.resolve();

process.on('message', (request: WorkerRequest) => {
	queue = queue.then(async () => {
		try {
			const rows = await handle(request);
			send({ kind: 'result', id: request.id, rows });
		} catch (error) {
			const { message, odbcErrors } = describeError(error);
			send({
				kind: 'error',
				id: request.id,
				error: message,
				odbcErrors,
				driverManagerMissing: isDriverManagerMissing(message) || undefined,
			});
		}
	});
});

// If the host goes away, there is nothing left to serve. Close the connection so the server sees a
// clean disconnect rather than an abandoned session, then exit.
process.on('disconnect', () => {
	const open = connection;
	connection = undefined;
	void Promise.resolve(open?.close()).catch(() => undefined).then(() => process.exit(0));
});

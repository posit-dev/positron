/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChildProcess, fork } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import {
	OdbcBindValue,
	OdbcErrorDetail,
	OdbcRow,
	WorkerConnectConfig,
	WorkerRequest,
	WorkerResponse
} from './odbcWorkerProtocol';
import { createWorkerEnv } from './workerEnv';

/** An Error carrying the ODBC driver's own diagnostics, when it supplied any. */
export type OdbcError = Error & {
	odbcErrors?: OdbcErrorDetail[];
	/** Set when the failure was the ODBC driver manager failing to load, not a connection problem. */
	driverManagerMissing?: boolean;
};

/**
 * The request surface the connection and schema-browsing code depends on. Implemented by
 * OdbcWorkerClient; kept as an interface so the node builders and the table view can be
 * unit-tested against a fake without forking a process.
 */
export interface IOdbcQueryClient {
	/** Runs a SQL query with optional positional (`?`) parameters and returns its rows. */
	runQuery(sql: string, params?: OdbcBindValue[]): Promise<OdbcRow[]>;

	/** SQLTables. Nulls mean "any"; `type` is a comma-separated list such as `'TABLE,VIEW'`. */
	tables(catalog: string | null, schema: string | null, table: string | null, type: string | null): Promise<OdbcRow[]>;

	/** SQLColumns. */
	columns(catalog: string | null, schema: string | null, table: string | null, column: string | null): Promise<OdbcRow[]>;

	/** SQLPrimaryKeys. */
	primaryKeys(catalog: string | null, schema: string | null, table: string): Promise<OdbcRow[]>;
}

/** How long to wait for a connection before giving up, in seconds. */
const CONNECTION_TIMEOUT_SECONDS = 30;

/**
 * Host-side proxy for an ODBC connection. The native connection runs in a separate child process
 * (`odbcWorker.ts`); this class forks it, forwards requests over IPC, and reconstructs results.
 *
 * Isolating the native binding means a faulty vendor driver takes down only the child. A native
 * abort cannot be caught in-process, so the child dying is the only thing that keeps the extension
 * host alive. When the worker dies, in-flight requests reject with a clear error, `onDidCrash`
 * fires, and the next request transparently respawns it -- which also re-establishes the ODBC
 * connection, since the worker connects on its first request.
 */
export class OdbcWorkerClient implements IOdbcQueryClient {
	/** Resolved path to the bundled worker entry, emitted next to this module. */
	private static readonly defaultWorkerPath = path.join(__dirname, 'odbcWorker.js');

	private _worker: ChildProcess | undefined;
	private _nextId = 0;
	private readonly _pending = new Map<number, { resolve: (rows: OdbcRow[]) => void; reject: (error: Error) => void }>();
	private _disposed = false;

	private readonly _onDidCrash = new vscode.EventEmitter<void>();
	/** Fires when the worker process terminates unexpectedly (e.g. a native abort in a driver). */
	readonly onDidCrash: vscode.Event<void> = this._onDidCrash.event;

	/**
	 * @param _connectionString The full ODBC connection string the worker connects with.
	 * @param _workerPath Overrides the worker entry point; exists only for tests (to exercise
	 * crash recovery with a stub worker).
	 */
	constructor(
		private readonly _connectionString: string,
		private readonly _workerPath: string = OdbcWorkerClient.defaultWorkerPath
	) { }

	/** Whether a worker process is currently running. */
	get isAlive(): boolean {
		return !this._disposed && this._worker !== undefined;
	}

	private spawnWorker(): void {
		// "advanced" serialization uses the V8 structured-clone algorithm, which preserves the
		// bigint and Buffer values ODBC drivers return for large integer and binary columns. The
		// connect config is passed as the first argument so the worker can connect immediately.
		const config: WorkerConnectConfig = {
			connectionString: this._connectionString,
			connectionTimeout: CONNECTION_TIMEOUT_SECONDS,
			loginTimeout: CONNECTION_TIMEOUT_SECONDS,
		};
		const worker = fork(
			this._workerPath,
			[JSON.stringify(config)],
			{ serialization: 'advanced', execArgv: [], env: createWorkerEnv() }
		);
		worker.on('message', (message: unknown) => {
			const response = message as WorkerResponse;
			const pending = this._pending.get(response.id);
			if (!pending) {
				return;
			}
			this._pending.delete(response.id);
			if (response.kind === 'result') {
				pending.resolve(response.rows);
			} else {
				const error: OdbcError = new Error(response.error);
				if (response.odbcErrors) {
					error.odbcErrors = response.odbcErrors;
				}
				if (response.driverManagerMissing) {
					error.driverManagerMissing = true;
				}
				pending.reject(error);
			}
		});
		worker.on('exit', (code, signal) => this.onWorkerGone(`exited (code=${code}, signal=${signal})`));
		worker.on('error', (error) => this.onWorkerGone(`failed to start: ${error.message}`));
		this._worker = worker;
	}

	/**
	 * Handle the worker process going away. Reject every in-flight request so callers fail
	 * gracefully rather than hanging, and notify listeners. The worker is respawned lazily on the
	 * next request.
	 */
	private onWorkerGone(detail: string): void {
		if (this._worker === undefined) {
			// Already handled (e.g. both 'error' and 'exit' fired), or disposed.
			return;
		}
		this._worker = undefined;

		const reason = new Error(`The ODBC process terminated unexpectedly (${detail}). This usually means the ODBC driver encountered a native fault.`);
		for (const pending of this._pending.values()) {
			pending.reject(reason);
		}
		this._pending.clear();

		if (!this._disposed) {
			this._onDidCrash.fire();
		}
	}

	/** Closes the worker process and rejects any in-flight requests. */
	dispose(): void {
		this._disposed = true;
		const worker = this._worker;
		this._worker = undefined;
		// Ask the worker to close the ODBC connection cleanly before it goes; the child exits on
		// its own once the IPC channel is gone, and is killed below if it does not.
		worker?.send({ kind: 'close', id: this._nextId++ } satisfies WorkerRequest);
		worker?.disconnect();
		worker?.kill();
		for (const pending of this._pending.values()) {
			pending.reject(new Error('The ODBC connection was disposed.'));
		}
		this._pending.clear();
		this._onDidCrash.dispose();
	}

	/**
	 * Sends a request, lazily (re)spawning the worker, e.g. after a crash. The caller supplies a
	 * factory rather than a request so the id this class mints is part of the literal, which keeps
	 * the request typed as a genuine WorkerRequest without an assertion.
	 */
	private send(makeRequest: (id: number) => WorkerRequest): Promise<OdbcRow[]> {
		if (this._disposed) {
			return Promise.reject(new Error('The ODBC connection was disposed.'));
		}
		if (this._worker === undefined) {
			this.spawnWorker();
		}

		const id = this._nextId++;
		return new Promise<OdbcRow[]>((resolve, reject) => {
			this._pending.set(id, { resolve, reject });
			this._worker!.send(makeRequest(id));
		});
	}

	/** Establishes the connection, so connect() can fail fast with a real error. */
	connect(): Promise<void> {
		return this.send(id => ({ kind: 'ping', id })).then(() => undefined);
	}

	runQuery(sql: string, params?: OdbcBindValue[]): Promise<OdbcRow[]> {
		return this.send(id => ({ kind: 'query', id, sql, params }));
	}

	tables(catalog: string | null, schema: string | null, table: string | null, type: string | null): Promise<OdbcRow[]> {
		return this.send(id => ({ kind: 'tables', id, catalog, schema, table, type }));
	}

	columns(catalog: string | null, schema: string | null, table: string | null, column: string | null): Promise<OdbcRow[]> {
		return this.send(id => ({ kind: 'columns', id, catalog, schema, table, column }));
	}

	primaryKeys(catalog: string | null, schema: string | null, table: string): Promise<OdbcRow[]> {
		return this.send(id => ({ kind: 'primaryKeys', id, catalog, schema, table }));
	}
}

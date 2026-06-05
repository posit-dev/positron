/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChildProcess, fork } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import {
	SqliteBindValue,
	WorkerOpenConfig,
	WorkerQueryRequest,
	WorkerQueryResponse
} from './sqliteWorkerProtocol.js';
import { createWorkerEnv } from './workerEnv.js';

/** A materialized result row, keyed by column name. */
export type SqliteRow = Record<string, unknown>;

/** An Error carrying the originating SQLite error code, when available. */
export type SqliteError = Error & { code?: string };

/**
 * The query surface the schema-browsing nodes depend on. Implemented by
 * SqliteWorkerClient; kept as an interface so node builders can be unit-tested
 * against a fake without forking a process.
 */
export interface ISqliteQueryClient {
	/** Run a SQL query with optional positional (?) parameters and return its rows. */
	runQuery(sql: string, params?: SqliteBindValue[]): Promise<SqliteRow[]>;
}

/**
 * Host-side proxy for a SQLite database. The native database runs in a separate
 * child process (`sqliteWorker.ts`); this class forks it, forwards queries over
 * IPC, and reconstructs results. Isolating the native binding means a corrupt
 * file or a native abort takes down only the child: a native abort cannot be
 * caught in-process, so the child dying is the only thing that keeps the
 * extension host alive. When the worker dies, in-flight queries reject with a
 * clear error, `onDidCrash` fires, and the next query transparently respawns it.
 */
export class SqliteWorkerClient implements ISqliteQueryClient {
	/** Resolved path to the bundled worker entry, emitted next to this module. */
	private static readonly defaultWorkerPath = path.join(__dirname, 'sqliteWorker.js');

	private _worker: ChildProcess | undefined;
	private _nextId = 0;
	private readonly _pending = new Map<number, { resolve: (rows: SqliteRow[]) => void; reject: (error: Error) => void }>();
	private _disposed = false;

	private readonly _onDidCrash = new vscode.EventEmitter<void>();
	/** Fires when the worker process terminates unexpectedly (e.g. a native abort). */
	readonly onDidCrash: vscode.Event<void> = this._onDidCrash.event;

	/**
	 * @param _config The database open configuration, forwarded to the worker.
	 * @param _workerPath Overrides the worker entry point; exists only for tests
	 * (to exercise crash recovery with a stub worker).
	 */
	constructor(
		private readonly _config: WorkerOpenConfig,
		private readonly _workerPath: string = SqliteWorkerClient.defaultWorkerPath
	) { }

	/** Whether a worker process is currently running. */
	get isAlive(): boolean {
		return !this._disposed && this._worker !== undefined;
	}

	private spawnWorker(): void {
		// "advanced" serialization uses the V8 structured-clone algorithm, which
		// preserves bigint and Buffer values returned by SQLite. The open config is
		// passed as the first argument so the worker opens the right database.
		const worker = fork(
			this._workerPath,
			[JSON.stringify(this._config)],
			{ serialization: 'advanced', execArgv: [], env: createWorkerEnv() }
		);
		worker.on('message', (message: unknown) => {
			const response = message as WorkerQueryResponse;
			const pending = this._pending.get(response.id);
			if (!pending) {
				return;
			}
			this._pending.delete(response.id);
			if (response.kind === 'result') {
				pending.resolve(response.rows);
			} else {
				const error: SqliteError = new Error(response.error);
				if (response.code) {
					error.code = response.code;
				}
				pending.reject(error);
			}
		});
		worker.on('exit', (code, signal) => this.onWorkerGone(`exited (code=${code}, signal=${signal})`));
		worker.on('error', (error) => this.onWorkerGone(`failed to start: ${error.message}`));
		this._worker = worker;
	}

	/**
	 * Handle the worker process going away. Reject every in-flight query so
	 * callers fail gracefully rather than hanging, and notify listeners. The
	 * worker is respawned lazily on the next query.
	 */
	private onWorkerGone(detail: string): void {
		if (this._worker === undefined) {
			// Already handled (e.g. both 'error' and 'exit' fired), or disposed.
			return;
		}
		this._worker = undefined;

		const reason = new Error(`The SQLite process terminated unexpectedly (${detail}). This usually means the database file is corrupt or a native fault occurred.`);
		for (const pending of this._pending.values()) {
			pending.reject(reason);
		}
		this._pending.clear();

		if (!this._disposed) {
			this._onDidCrash.fire();
		}
	}

	/** Closes the worker process and rejects any in-flight queries. */
	dispose(): void {
		this._disposed = true;
		const worker = this._worker;
		this._worker = undefined;
		worker?.kill();
		for (const pending of this._pending.values()) {
			pending.reject(new Error('The SQLite connection was disposed.'));
		}
		this._pending.clear();
		this._onDidCrash.dispose();
	}

	runQuery(sql: string, params?: SqliteBindValue[]): Promise<SqliteRow[]> {
		if (this._disposed) {
			return Promise.reject(new Error('The SQLite connection was disposed.'));
		}
		// Lazily (re)spawn the worker, e.g. after a crash.
		if (this._worker === undefined) {
			this.spawnWorker();
		}

		const id = this._nextId++;
		const request: WorkerQueryRequest = { id, sql, params };
		return new Promise<SqliteRow[]>((resolve, reject) => {
			this._pending.set(id, { resolve, reject });
			this._worker!.send(request);
		});
	}
}

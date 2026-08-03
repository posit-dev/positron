/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChildProcess, fork } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import {
	WorkerCatalogInfo,
	WorkerColumnSchema,
	WorkerObjectDepth,
	WorkerOpenConfig,
	WorkerRequest,
	WorkerResponse,
} from './adbcWorkerProtocol.js';
import { createWorkerEnv } from './workerEnv.js';

/** A materialized result row, keyed by column name. */
export type AdbcRow = Record<string, unknown>;

/** An Error carrying the ADBC status code and vendor SQLSTATE, when available. */
export type AdbcRequestError = Error & { code?: string; sqlState?: string };

/** Identifies the table a metadata or schema request applies to. */
export interface AdbcTableRef {
	catalog?: string;
	dbSchema?: string;
	tableName: string;
}

/**
 * The query surface the Data Explorer table views depend on. Kept as an
 * interface so the views can be unit-tested against a fake without forking a
 * process.
 */
export interface IAdbcQueryClient {
	/** Run a SQL query and return its rows. */
	runQuery(sql: string): Promise<AdbcRow[]>;
}

/**
 * The metadata surface the schema-browsing nodes depend on, beyond plain
 * queries. Kept as an interface so node builders can be unit-tested against a
 * fake.
 */
export interface IAdbcMetadataClient extends IAdbcQueryClient {
	/** Retrieve catalog/schema/table/column metadata at the requested depth. */
	getObjects(options: {
		depth: WorkerObjectDepth;
		catalog?: string;
		dbSchema?: string;
		tableName?: string;
		tableType?: string[];
	}): Promise<WorkerCatalogInfo[]>;

	/** Retrieve the column schema of a single table. */
	getTableSchema(ref: AdbcTableRef): Promise<WorkerColumnSchema[]>;

	/** Retrieve the column schema a query would produce, without fetching its rows. */
	getQuerySchema(sql: string): Promise<WorkerColumnSchema[]>;
}

/**
 * Host-side proxy for an ADBC connection. The driver manager and the vendor
 * driver shared library run in a separate child process (`adbcWorker.ts`); this
 * class forks it, forwards requests over IPC, and reconstructs results.
 *
 * Isolating the driver matters because this is the escape-hatch driver: the
 * library loaded is arbitrary third-party code, and a native abort in it cannot
 * be caught in-process, so the child dying is the only thing that keeps the
 * extension host alive. When the worker dies, in-flight requests reject with a
 * clear error, `onDidCrash` fires, and the next request transparently respawns
 * it (reconnecting to the database in the process).
 */
export class AdbcWorkerClient implements IAdbcMetadataClient {
	/** Resolved path to the bundled worker entry, emitted next to this module. */
	private static readonly defaultWorkerPath = path.join(__dirname, 'adbcWorker.js');

	private _worker: ChildProcess | undefined;
	private _nextId = 0;
	private readonly _pending = new Map<number, { resolve: (response: WorkerResponse) => void; reject: (error: Error) => void }>();
	private _disposed = false;

	private readonly _onDidCrash = new vscode.EventEmitter<void>();
	/** Fires when the worker process terminates unexpectedly (e.g. a native abort). */
	readonly onDidCrash: vscode.Event<void> = this._onDidCrash.event;

	/**
	 * @param _config The driver open configuration, forwarded to the worker.
	 * @param _workerPath Overrides the worker entry point; exists only for tests
	 * (to exercise crash recovery with a stub worker).
	 */
	constructor(
		private readonly _config: WorkerOpenConfig,
		private readonly _workerPath: string = AdbcWorkerClient.defaultWorkerPath
	) { }

	/** Whether a worker process is currently running. */
	get isAlive(): boolean {
		return !this._disposed && this._worker !== undefined;
	}

	private spawnWorker(): void {
		// "advanced" serialization uses the V8 structured-clone algorithm, which
		// preserves the bigint, Date, and Buffer values the worker produces for
		// 64-bit integer, timestamp, and binary columns. The open config is passed as
		// the first argument so the worker loads the right driver.
		const worker = fork(
			this._workerPath,
			[JSON.stringify(this._config)],
			{ serialization: 'advanced', execArgv: [], env: createWorkerEnv() }
		);
		worker.on('message', (message: unknown) => {
			const response = message as WorkerResponse;
			const pending = this._pending.get(response.id);
			if (!pending) {
				return;
			}
			this._pending.delete(response.id);
			if (response.kind === 'error') {
				const error: AdbcRequestError = new Error(response.error);
				if (response.code) {
					error.code = response.code;
				}
				if (response.sqlState) {
					error.sqlState = response.sqlState;
				}
				pending.reject(error);
			} else {
				pending.resolve(response);
			}
		});
		worker.on('exit', (code, signal) => this.onWorkerGone(`exited (code=${code}, signal=${signal})`));
		worker.on('error', (error) => this.onWorkerGone(`failed to start: ${error.message}`));
		this._worker = worker;
	}

	/**
	 * Handle the worker process going away. Reject every in-flight request so
	 * callers fail gracefully rather than hanging, and notify listeners. The
	 * worker is respawned lazily on the next request.
	 */
	private onWorkerGone(detail: string): void {
		if (this._worker === undefined) {
			// Already handled (e.g. both 'error' and 'exit' fired), or disposed.
			return;
		}
		this._worker = undefined;

		const reason = new Error(`The ADBC driver process terminated unexpectedly (${detail}). This usually means the driver library faulted or was unable to load.`);
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
		// Disconnecting lets the worker close the driver handles cleanly; the kill is
		// the backstop for a worker that is wedged in native code and never exits.
		worker?.disconnect();
		worker?.kill();
		for (const pending of this._pending.values()) {
			pending.reject(new Error('The ADBC connection was disposed.'));
		}
		this._pending.clear();
		this._onDidCrash.dispose();
	}

	/** Sends a request to the worker, spawning it first if it is not running. */
	private send(build: (id: number) => WorkerRequest): Promise<WorkerResponse> {
		if (this._disposed) {
			return Promise.reject(new Error('The ADBC connection was disposed.'));
		}
		// Lazily (re)spawn the worker, e.g. after a crash.
		if (this._worker === undefined) {
			this.spawnWorker();
		}

		const id = this._nextId++;
		const request = build(id);
		return new Promise<WorkerResponse>((resolve, reject) => {
			this._pending.set(id, { resolve, reject });
			this._worker!.send(request);
		});
	}

	async runQuery(sql: string): Promise<AdbcRow[]> {
		const response = await this.send(id => ({ kind: 'query', id, sql }));
		return response.kind === 'rows' ? response.rows : [];
	}

	async getObjects(options: {
		depth: WorkerObjectDepth;
		catalog?: string;
		dbSchema?: string;
		tableName?: string;
		tableType?: string[];
	}): Promise<WorkerCatalogInfo[]> {
		const response = await this.send(id => ({ kind: 'objects', id, ...options }));
		return response.kind === 'objects' ? response.catalogs : [];
	}

	async getTableSchema(ref: AdbcTableRef): Promise<WorkerColumnSchema[]> {
		const response = await this.send(id => ({ kind: 'tableSchema', id, ...ref }));
		return response.kind === 'tableSchema' ? response.columns : [];
	}

	async getQuerySchema(sql: string): Promise<WorkerColumnSchema[]> {
		const response = await this.send(id => ({ kind: 'querySchema', id, sql }));
		return response.kind === 'tableSchema' ? response.columns : [];
	}

	/** Confirms the worker is running and its connection is open. */
	async ping(): Promise<void> {
		await this.send(id => ({ kind: 'ping', id }));
	}

	/**
	 * Asks the driver what engine it is connected to, for dialect detection. Returns an
	 * empty result rather than throwing when the driver does not implement GetInfo.
	 */
	async getInfo(): Promise<{ vendorName?: string; driverName?: string }> {
		const response = await this.send(id => ({ kind: 'info', id }));
		return response.kind === 'info'
			? { vendorName: response.vendorName, driverName: response.driverName }
			: {};
	}
}

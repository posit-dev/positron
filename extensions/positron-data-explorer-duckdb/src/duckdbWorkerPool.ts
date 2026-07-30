/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DuckDBWorkerClient } from './duckdbWorkerClient.js';
import { WorkerOpenConfig } from './duckdbWorkerProtocol.js';

/**
 * A borrowed reference to a shared DuckDBWorkerClient. Call {@link release} exactly once when the
 * borrowing connection is done with it; the pool disposes the underlying worker (killing its
 * process and releasing the database file lock) once the last lease for a file is released.
 */
export interface IDuckDBWorkerLease {
	/** The shared worker client. Do not dispose it directly -- call {@link release} instead. */
	readonly client: DuckDBWorkerClient;

	/** Releases this lease. Idempotent; only the first call counts against the refcount. */
	release(): void;
}

/**
 * Shares one DuckDBWorkerClient -- and therefore one worker process, one native DuckDBInstance, and
 * one database file lock -- across every connection that opens the same database file in the same
 * mode.
 *
 * DuckDB takes an exclusive OS-level lock on a database file opened read-write, so two separate
 * worker processes cannot open the same file at once: the second `DuckDBInstance.create` fails with
 * a conflicting-lock error. Two saved profiles that resolve to the same absolute path (e.g. a `~/`
 * path and a workspace-relative `../` path pointing at one file) would otherwise hit exactly that,
 * so the first opened connection wins and the second always fails. Pooling by resolved path + mode
 * lets same-file connections reuse one worker (DuckDB's own one-instance-many-connections model),
 * while connections to different files keep their own isolated worker.
 *
 * Read-only and read-write opens of the same file are keyed separately, since a single native
 * instance cannot serve both access modes; that combination remains a genuine lock conflict.
 */
export class DuckDBWorkerPool {
	/** Live entries keyed by {@link poolKey}, each tracking a shared client and its lease count. */
	private readonly _entries = new Map<string, { readonly client: DuckDBWorkerClient; refCount: number }>();

	/**
	 * Borrows the shared worker for the given open configuration, spawning one if this is the first
	 * lease for that file + mode. The returned lease must be released exactly once.
	 */
	acquire(config: WorkerOpenConfig): IDuckDBWorkerLease {
		const key = poolKey(config);
		let entry = this._entries.get(key);
		if (!entry) {
			entry = { client: new DuckDBWorkerClient(config), refCount: 0 };
			this._entries.set(key, entry);
		}
		entry.refCount++;

		let released = false;
		return {
			client: entry.client,
			release: () => {
				if (released) {
					return;
				}
				released = true;
				if (--entry.refCount === 0) {
					entry.client.dispose();
					this._entries.delete(key);
				}
			},
		};
	}
}

/**
 * Keys a pool entry by access mode and resolved database path. The NUL separator cannot appear in a
 * filesystem path, so it cannot let a path collide with the mode prefix.
 */
function poolKey(config: WorkerOpenConfig): string {
	return `${config.readOnly ? 'ro' : 'rw'}\0${config.databasePath}`;
}

/** The process-wide pool shared by every DuckDB connection in this extension host. */
export const duckDBWorkerPool = new DuckDBWorkerPool();

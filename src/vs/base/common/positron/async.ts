/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * A lazily computed async value that never caches failure: the first call to
 * {@link get} starts the computation and concurrent callers share it, but if it
 * rejects the cache clears so the next call retries instead of replaying the
 * rejection for the lifetime of the holder. {@link clear} drops the value
 * (settled or in-flight) so the next call recomputes.
 */
export class SelfHealingLazyPromise<T> {

	private _value: Promise<T> | undefined;

	constructor(private readonly _compute: () => Promise<T>) { }

	get(): Promise<T> {
		if (!this._value) {
			const value = this._compute().catch(err => {
				// Only clear our own promise: a clear() + get() during the
				// in-flight computation must not have its fresh value wiped.
				if (this._value === value) {
					this._value = undefined;
				}
				throw err;
			});
			this._value = value;
		}
		return this._value;
	}

	clear(): void {
		this._value = undefined;
	}
}

export class PendingTaskMap<K, V> {
	constructor(
		private readonly map: Map<K, Promise<V>>,
	) { }

	getOrRun(key: K, task: () => Promise<V>): Promise<V> {
		const existing = this.map.get(key);
		if (existing) {
			return existing;
		}
		const promise = task().finally(() => {
			if (this.map.get(key) === promise) {
				this.map.delete(key);
			}
		});
		this.map.set(key, promise);
		return promise;
	}
}

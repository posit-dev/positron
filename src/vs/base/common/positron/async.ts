/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

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

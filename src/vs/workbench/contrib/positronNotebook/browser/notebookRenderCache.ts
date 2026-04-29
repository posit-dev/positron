/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { PositronReactRenderer } from '../../../../base/browser/positronReactRenderer.js';
import { isEqual } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';

/**
 * One cached notebook render. Holds the DOM container that React was mounted
 * into and the renderer that owns that mount. The container is reparented in
 * and out of the host's shell on setInput/clearInput; the renderer is only
 * disposed when the entry is evicted.
 */
export interface ICachedNotebookRender {
	readonly uri: URI;
	readonly container: HTMLElement;
	readonly renderer: PositronReactRenderer;
}

/**
 * Bounded LRU cache of notebook renders keyed by URI. The cache is policy-
 * only: it holds entries in least-recently-used to most-recently-used order
 * and invokes the supplied `onEvict` callback when an entry leaves the cache.
 * Disposal of the renderer, DOM container, and shared notebook instance is
 * the caller's responsibility, performed inside `onEvict`.
 */
export class NotebookRenderCache {
	private _entries: ICachedNotebookRender[] = [];

	constructor(
		private readonly _capacity: number,
		private readonly _onEvict: (entry: ICachedNotebookRender) => void,
	) { }

	get size(): number {
		return this._entries.length;
	}

	/** Read-only view of the entries in LRU-to-MRU order. */
	entries(): readonly ICachedNotebookRender[] {
		return this._entries;
	}

	/**
	 * Look up an entry by URI. On hit, the entry is moved to the most-
	 * recently-used position and returned. On miss, returns undefined.
	 */
	get(uri: URI): ICachedNotebookRender | undefined {
		const idx = this._entries.findIndex(e => isEqual(e.uri, uri));
		if (idx === -1) {
			return undefined;
		}
		const entry = this._entries[idx];
		this._entries.splice(idx, 1);
		this._entries.push(entry);
		return entry;
	}

	/**
	 * Append a new entry as most-recently-used. If the cache is already at
	 * capacity, the least-recently-used entry is evicted first.
	 *
	 * Caller contract: the URI must not already be present (call `get` first
	 * and only `add` on miss).
	 */
	add(entry: ICachedNotebookRender): void {
		if (this._entries.length >= this._capacity) {
			const evicted = this._entries.shift()!;
			this._onEvict(evicted);
		}
		this._entries.push(entry);
	}

	/**
	 * Remove and dispose the entry matching the URI, if any. No-op when no
	 * entry matches.
	 */
	remove(uri: URI): void {
		const idx = this._entries.findIndex(e => isEqual(e.uri, uri));
		if (idx === -1) {
			return;
		}
		const [entry] = this._entries.splice(idx, 1);
		this._onEvict(entry);
	}

	/**
	 * Dispose all entries. Eviction order is most-recently-used first so the
	 * caller can rely on a deterministic teardown sequence.
	 */
	clear(): void {
		const drained = this._entries.slice().reverse();
		this._entries.length = 0;
		for (const entry of drained) {
			this._onEvict(entry);
		}
	}
}

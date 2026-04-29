/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { PositronReactRenderer } from '../../../../base/browser/positronReactRenderer.js';
import { isEqual } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';

/** One cached notebook render: the DOM container plus the renderer that owns its React mount. */
export interface ICachedNotebookRender {
	readonly uri: URI;
	readonly container: HTMLElement;
	readonly renderer: PositronReactRenderer;
}

/**
 * Bounded LRU cache of notebook renders keyed by URI. Disposal of evicted
 * entries is delegated to the `onEvict` callback supplied by the caller.
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

	/** Lookup by URI; on hit, promotes the entry to most-recently-used. */
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
	 * Append a new entry as most-recently-used, evicting the LRU entry first
	 * if at capacity. Caller must ensure the URI is not already present.
	 */
	add(entry: ICachedNotebookRender): void {
		if (this._entries.length >= this._capacity) {
			const evicted = this._entries.shift()!;
			this._onEvict(evicted);
		}
		this._entries.push(entry);
	}

	/** Remove and evict the entry matching the URI, if any. */
	remove(uri: URI): void {
		const idx = this._entries.findIndex(e => isEqual(e.uri, uri));
		if (idx === -1) {
			return;
		}
		const [entry] = this._entries.splice(idx, 1);
		this._onEvict(entry);
	}

	/** Evict all entries in MRU-first order so callers get a deterministic teardown sequence. */
	clear(): void {
		const drained = this._entries.slice().reverse();
		this._entries.length = 0;
		for (const entry of drained) {
			this._onEvict(entry);
		}
	}
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createSingleCallFunction } from '../../../../../base/common/functional.js';
import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { CellEditor } from './CellEditor.js';

/**
 * Pools live {@link CellEditor} instances so a single editor (and its Monaco
 * {@link CodeEditorWidget}, owned DOM and context-key scope) can be re-pointed
 * at a different cell via {@link CellEditor.setCell} instead of being disposed
 * and recreated.
 *
 * Mirrors the chat `EditorPool` (chat/browser/widget/chatContentParts): the
 * React {@link CellEditorMonacoWidget} acquires an editor with {@link get},
 * mounts {@link CellEditor.element} into the cell's row, binds it to the cell,
 * and releases the {@link IDisposableReference} on unmount. Releasing resets the
 * editor (detaching cell + DOM) and returns it to the idle set for reuse.
 *
 * Keyed by cell URI so a remount of the same cell prefers the editor that last
 * served it; the key is a best-effort hint and the pool falls back to any idle
 * editor when no keyed match is free.
 */
export class CellEditorPool extends Disposable {
	private readonly _pool: KeyedResourcePool<CellEditor>;

	/** The editors currently checked out of the pool. */
	get inUse(): ReadonlySet<CellEditor> {
		return this._pool.inUse;
	}

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();

		this._pool = this._register(new KeyedResourcePool(
			() => instantiationService.createInstance(CellEditor),
			{ maxIdleSize: 2 },
		));
	}

	/**
	 * Acquire an editor for the cell identified by `key` (its URI). Prefers the
	 * editor that last served this key. The returned reference must be disposed
	 * when the cell unmounts, which resets the editor and returns it to the pool.
	 */
	get(key: string): IDisposableReference<CellEditor> {
		const cellEditor = this._pool.get(key);
		let stale = false;
		return {
			object: cellEditor,
			isStale: () => stale,
			dispose: createSingleCallFunction(() => {
				cellEditor.reset();
				stale = true;
				this._pool.release(cellEditor, key);
			})
		};
	}

	clear(): void {
		this._pool.clear();
	}
}

/**
 * Maximum number of idle items to keep in the pool before trimming.
 */
export interface IResourcePoolOptions {
	/**
	 * Maximum number of idle items to keep in the pool. When exceeded after a
	 * debounce period, excess idle items are disposed. Defaults to no limit.
	 */
	maxIdleSize?: number;

	/**
	 * Delay in milliseconds before trimming excess idle items. Allows rapid
	 * get/release cycles (e.g. during scrolling) without unnecessary disposal.
	 * Defaults to 10 seconds.
	 */
	trimIdleDelay?: number;
}

/**
 * A resource pool that supports keyed reuse. On {@link get}, the pool will
 * prefer returning an idle item that was previously {@link release released}
 * with the same key. Keys are best-effort hints -- multiple items can share a
 * key and the pool falls back to any idle item when no keyed match is found.
 *
 * Adapted from chat/browser/widget/chatContentParts/chatCollections.ts. Copied
 * (rather than imported) to avoid a cross-contrib dependency on the chat
 * widget internals.
 */
export class KeyedResourcePool<T extends IDisposable> implements IDisposable {
	private readonly _idle: T[] = [];
	private readonly _inUse = new Set<T>();
	private readonly _keyToItems = new Map<string, Set<T>>();
	private readonly _itemToKey = new Map<T, string>();
	private _trimTimer: ReturnType<typeof setTimeout> | undefined;

	get inUse(): ReadonlySet<T> {
		return this._inUse;
	}

	constructor(
		private readonly _itemFactory: () => T,
		private readonly _options?: IResourcePoolOptions,
	) { }

	get(key: string): T {
		const candidates = this._keyToItems.get(key);
		if (candidates) {
			for (const item of candidates) {
				if (!this._inUse.has(item)) {
					const idx = this._idle.indexOf(item);
					if (idx !== -1) {
						this._idle.splice(idx, 1);
						this._inUse.add(item);
						return item;
					}
				}
			}
		}

		if (this._idle.length > 0) {
			const item = this._idle.pop()!;
			this._inUse.add(item);
			return item;
		}

		const item = this._itemFactory();
		this._inUse.add(item);
		return item;
	}

	release(item: T, key: string): void {
		this._inUse.delete(item);
		this._idle.push(item);

		// Remove old key association if it changed.
		const oldKey = this._itemToKey.get(item);
		if (oldKey !== undefined && oldKey !== key) {
			const oldSet = this._keyToItems.get(oldKey);
			if (oldSet) {
				oldSet.delete(item);
				if (oldSet.size === 0) {
					this._keyToItems.delete(oldKey);
				}
			}
		}

		this._itemToKey.set(item, key);
		let keySet = this._keyToItems.get(key);
		if (!keySet) {
			keySet = new Set();
			this._keyToItems.set(key, keySet);
		}
		keySet.add(item);

		this._scheduleTrim();
	}

	private _scheduleTrim(): void {
		const maxIdle = this._options?.maxIdleSize;
		if (maxIdle === undefined || this._idle.length <= maxIdle) {
			return;
		}

		if (this._trimTimer !== undefined) {
			clearTimeout(this._trimTimer);
		}
		const delay = this._options?.trimIdleDelay ?? 10_000;
		this._trimTimer = setTimeout(() => {
			this._trimTimer = undefined;
			this._trimIdle();
		}, delay);
	}

	private _trimIdle(): void {
		const maxIdle = this._options?.maxIdleSize;
		if (maxIdle === undefined) {
			return;
		}

		while (this._idle.length > maxIdle) {
			const item = this._idle.pop()!;
			this._removeFromMaps(item);
			item.dispose();
		}
	}

	private _removeFromMaps(item: T): void {
		const key = this._itemToKey.get(item);
		if (key !== undefined) {
			const keySet = this._keyToItems.get(key);
			if (keySet) {
				keySet.delete(item);
				if (keySet.size === 0) {
					this._keyToItems.delete(key);
				}
			}
			this._itemToKey.delete(item);
		}
	}

	clear(): void {
		if (this._trimTimer !== undefined) {
			clearTimeout(this._trimTimer);
			this._trimTimer = undefined;
		}
		for (const item of this._idle) {
			item.dispose();
		}
		this._idle.length = 0;
		this._keyToItems.clear();
		this._itemToKey.clear();
	}

	dispose(): void {
		this.clear();

		for (const item of this._inUse) {
			item.dispose();
		}
		this._inUse.clear();
	}
}

export interface IDisposableReference<T> extends IDisposable {
	object: T;
	isStale: () => boolean;
}

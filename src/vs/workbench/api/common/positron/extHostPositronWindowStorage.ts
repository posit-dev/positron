/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { DeferredPromise, RunOnceScheduler } from '../../../../base/common/async.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { IExtHostRpcService } from '../extHostRpcService.js';
import { MainPositronContext, MainThreadPositronWindowStorageShape } from './extHost.positron.protocol.js';
import { ILogService } from '../../../../platform/log/common/log.js';

/**
 * Ext-host side of the window-scoped extension storage. Communicates with
 * `MainThreadPositronWindowStorage` over the Positron RPC protocol.
 */
export class ExtHostPositronWindowStorage {

	private readonly _proxy: MainThreadPositronWindowStorageShape;
	private readonly _mementos = new Map<string, WindowExtensionMemento>();

	constructor(
		rpcProtocol: IExtHostRpcService,
		private readonly _logService: ILogService,
	) {
		this._proxy = rpcProtocol.getProxy(MainPositronContext.MainThreadPositronWindowStorage);
	}

	async initializeWindowStorage(extensionId: string, defaultValue?: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
		const raw = await this._proxy.$initializeWindowStorage(extensionId);
		if (raw) {
			try {
				const parsed = JSON.parse(raw);
				if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
					return parsed;
				}
				this._logService.error(`[extHostPositronWindowStorage] stored value is not a plain object (extensionId: ${extensionId})`);
			} catch (error) {
				this._logService.error(`[extHostPositronWindowStorage] unexpected error parsing window storage (extensionId: ${extensionId}): ${error}`);
			}
		}
		return defaultValue;
	}

	setWindowValue(extensionId: string, value: string): Promise<void> {
		return this._proxy.$setWindowValue(extensionId, value);
	}

	deleteWindowValue(extensionId: string): Promise<void> {
		return this._proxy.$deleteWindowValue(extensionId);
	}

	getOrCreateMemento(extensionId: string): WindowExtensionMemento {
		let memento = this._mementos.get(extensionId);
		if (!memento) {
			// Evict from cache on dispose so that re-activation gets a fresh instance
			memento = new WindowExtensionMemento(extensionId, this, () => {
				this._mementos.delete(extensionId);
			});
			this._mementos.set(extensionId, memento);
		}
		return memento;
	}
}

/**
 * `vscode.Memento` implementation backed by window-scoped storage. Data
 * survives extension host restarts and window reloads but does not persist
 * beyond the lifetime of the application process.
 *
 * Modelled after upstream `ExtensionMemento` in `extHostMemento.ts`.
 * Copied: field layout, constructor init + batched-flush scheduler,
 * `keys()`, `get()`, `update()`, `whenReady`, `dispose()`.
 * Dropped: `_storageListener` (no cross-process change events for
 * window storage).
 * Added: `clear()` to wipe all state for an extension in one call.
 *
 * Cannot extend `ExtensionMemento` directly because its key fields
 * (`_value`, `_scheduler`, `_deferredPromises`) are private and its
 * constructor is hardwired to `ExtHostStorage`.
 */
export class WindowExtensionMemento implements vscode.Memento, IDisposable {

	private _value: { [n: string]: unknown } = Object.create(null);
	private readonly _init: Promise<WindowExtensionMemento>;
	private _deferredPromises: Map<string, DeferredPromise<void>> = new Map();
	private readonly _scheduler: RunOnceScheduler;

	private readonly _storage!: ExtHostPositronWindowStorage;

	constructor(
		private readonly _id: string,
		storage: ExtHostPositronWindowStorage,
		private readonly _onDispose: () => void,
	) {
		// Non-enumerable to match TypeScript `private` intent at runtime and
		// prevent the RPC proxy at `_storage._proxy` from being discovered
		// by the `assertNoRpcFromEntry` integration test walk.
		Object.defineProperty(this, '_storage', { value: storage, enumerable: false });
		this._init = this._storage.initializeWindowStorage(this._id, Object.create(null)).then(value => {
			this._value = value ?? Object.create(null);
			return this;
		});

		this._scheduler = new RunOnceScheduler(() => {
			const records = this._deferredPromises;
			this._deferredPromises = new Map();
			(async () => {
				try {
					await this._storage.setWindowValue(this._id, JSON.stringify(this._value));
					for (const value of records.values()) {
						value.complete();
					}
				} catch (e) {
					for (const value of records.values()) {
						value.error(e);
					}
				}
			})();
		}, 0);
	}

	get whenReady(): Promise<WindowExtensionMemento> {
		return this._init;
	}

	keys(): readonly string[] {
		return Object.entries(this._value).filter(([, value]) => value !== undefined).map(([key]) => key);
	}

	get<T>(key: string): T | undefined;
	get<T>(key: string, defaultValue: T): T;
	get<T>(key: string, defaultValue?: T): T {
		let value = this._value[key];
		if (typeof value === 'undefined') {
			value = defaultValue;
		}
		return value as T;
	}

	update(key: string, value: any): Promise<void> {
		if (value !== null && typeof value === 'object') {
			this._value[key] = JSON.parse(JSON.stringify(value));
		} else {
			this._value[key] = value;
		}

		const record = this._deferredPromises.get(key);
		if (record !== undefined) {
			return record.p;
		}

		const promise = new DeferredPromise<void>();
		this._deferredPromises.set(key, promise);

		if (!this._scheduler.isScheduled()) {
			this._scheduler.schedule();
		}

		return promise.p;
	}

	/**
	 * Remove all window-scoped state for this extension.
	 */
	async clear(): Promise<void> {
		this._value = Object.create(null);
		this._scheduler.cancel();
		const records = this._deferredPromises;
		this._deferredPromises = new Map();
		for (const deferred of records.values()) {
			deferred.complete();
		}
		return this._storage.deleteWindowValue(this._id);
	}

	dispose(): void {
		this._onDispose();
		this._scheduler.flush();
		this._scheduler.dispose();
	}
}

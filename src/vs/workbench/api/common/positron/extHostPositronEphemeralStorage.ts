/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { DeferredPromise, RunOnceScheduler } from '../../../../base/common/async.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { IExtHostRpcService } from '../extHostRpcService.js';
import { MainPositronContext, MainThreadPositronEphemeralStorageShape } from './extHost.positron.protocol.js';
import { ILogService } from '../../../../platform/log/common/log.js';

/**
 * Ext-host side of the per-workspace ephemeral extension storage.
 * Communicates with `MainThreadPositronEphemeralStorage` over the
 * Positron RPC protocol.
 */
export class ExtHostPositronEphemeralStorage {

	private readonly _proxy: MainThreadPositronEphemeralStorageShape;
	private readonly _mementos = new Map<string, EphemeralExtensionMemento>();

	constructor(
		rpcProtocol: IExtHostRpcService,
		private readonly _logService: ILogService,
	) {
		this._proxy = rpcProtocol.getProxy(MainPositronContext.MainThreadPositronEphemeralStorage);
	}

	async initializeEphemeralStorage(extensionId: string, defaultValue?: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
		const raw = await this._proxy.$initializeEphemeralStorage(extensionId);
		if (raw) {
			try {
				const parsed = JSON.parse(raw);
				if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
					return parsed;
				}
				this._logService.error(`[extHostPositronEphemeralStorage] stored value is not a plain object (extensionId: ${extensionId})`);
			} catch (error) {
				this._logService.error(`[extHostPositronEphemeralStorage] unexpected error parsing window storage (extensionId: ${extensionId}): ${error}`);
			}
		}
		return defaultValue;
	}

	setEphemeralValue(extensionId: string, value: string): Promise<void> {
		return this._proxy.$setEphemeralValue(extensionId, value);
	}

	deleteEphemeralValue(extensionId: string): Promise<void> {
		return this._proxy.$deleteEphemeralValue(extensionId);
	}

	getOrCreateMemento(extensionId: string): EphemeralExtensionMemento {
		let memento = this._mementos.get(extensionId);
		if (!memento) {
			// Evict from cache on dispose so that re-activation gets a fresh instance
			memento = new EphemeralExtensionMemento(extensionId, this, () => {
				this._mementos.delete(extensionId);
			});
			this._mementos.set(extensionId, memento);
		}
		return memento;
	}
}

/**
 * `vscode.Memento` implementation backed by per-workspace ephemeral
 * storage. Data survives extension host restarts and window reloads
 * but does not persist beyond the lifetime of the application process.
 *
 * Modelled after upstream `ExtensionMemento` in `extHostMemento.ts`.
 * Copied: field layout, constructor init + batched-flush scheduler,
 * `keys()`, `get()`, `update()`, `whenReady`, `dispose()`.
 * Dropped: `_storageListener` (no cross-process change events for
 * ephemeral storage).
 * Added: `clear()` to wipe all state for an extension in one call.
 *
 * Cannot extend `ExtensionMemento` directly because its key fields
 * (`_value`, `_scheduler`, `_deferredPromises`) are private and its
 * constructor is hardwired to `ExtHostStorage`.
 */
export class EphemeralExtensionMemento implements vscode.Memento, IDisposable {

	private _value: { [n: string]: unknown } = Object.create(null);
	private readonly _init: Promise<EphemeralExtensionMemento>;
	private _deferredPromises: Map<string, DeferredPromise<void>> = new Map();
	private readonly _scheduler: RunOnceScheduler;

	private readonly _storage!: ExtHostPositronEphemeralStorage;

	constructor(
		private readonly _id: string,
		storage: ExtHostPositronEphemeralStorage,
		private readonly _onDispose: () => void,
	) {
		// Non-enumerable to match TypeScript `private` intent at runtime and
		// prevent the RPC proxy at `_storage._proxy` from being discovered
		// by the `assertNoRpcFromEntry` integration test walk.
		Object.defineProperty(this, '_storage', { value: storage, enumerable: false });
		this._init = this._storage.initializeEphemeralStorage(this._id, Object.create(null)).then(value => {
			this._value = value ?? Object.create(null);
			return this;
		});

		this._scheduler = new RunOnceScheduler(() => {
			const records = this._deferredPromises;
			this._deferredPromises = new Map();
			(async () => {
				try {
					await this._storage.setEphemeralValue(this._id, JSON.stringify(this._value));
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

	get whenReady(): Promise<EphemeralExtensionMemento> {
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
	 * Remove all ephemeral state for this extension.
	 */
	async clear(): Promise<void> {
		this._value = Object.create(null);
		this._scheduler.cancel();
		const records = this._deferredPromises;
		this._deferredPromises = new Map();
		for (const deferred of records.values()) {
			deferred.complete();
		}
		return this._storage.deleteEphemeralValue(this._id);
	}

	dispose(): void {
		this._onDispose();
		this._scheduler.flush();
		this._scheduler.dispose();
	}
}

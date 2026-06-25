/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as extHostProtocol from './extHost.positron.protocol.js';
import { Disposable } from '../extHostTypes.js';
import { IDataExplorerRpcDto, IDataExplorerResponseDto } from '../../../services/positronDataExplorer/common/dataExplorerRpcTransport.js';

/** How long $handleRpc waits for a provider to register before failing (covers activation races). */
const PROVIDER_REGISTRATION_TIMEOUT_MS = 30_000;

/**
 * Extension host implementation for the `positron.dataExplorer` API namespace.
 *
 * A backend-providing extension registers an RPC handler under a provider id; the main thread then
 * routes Data Explorer RPCs for that provider's datasets here via `$handleRpc`. The extension pushes
 * async frontend events (e.g. column profiles) back through the session's `sendUiEvent`, and opens
 * datasets via `open`. This replaces the previous command-based transport and its global
 * `positron-data-explorer.sendUiEvent` command.
 */
export class ExtHostDataExplorer implements extHostProtocol.ExtHostDataExplorerShape {

	private readonly _proxy: extHostProtocol.MainThreadDataExplorerShape;

	/** Registered RPC handlers, keyed by provider id. */
	private readonly _handlers = new Map<string, positron.DataExplorerRpcHandler>();

	/** Resolvers for $handleRpc calls waiting on a provider that hasn't registered yet. */
	private readonly _pendingRegistrations = new Map<string, Array<() => void>>();

	constructor(mainContext: extHostProtocol.IMainPositronContext) {
		this._proxy = mainContext.getProxy(extHostProtocol.MainPositronContext.MainThreadDataExplorer);
	}

	// --- Public API (positron.dataExplorer.*) ---

	/**
	 * Registers an RPC handler under a provider id and returns a session for pushing UI events.
	 */
	registerRpcHandler(providerId: string, handler: positron.DataExplorerRpcHandler): positron.DataExplorerRpcSession {
		this._handlers.set(providerId, handler);
		this._proxy.$registerRpcHandler(providerId);

		// Unblock any RPCs that arrived before this provider registered.
		const waiters = this._pendingRegistrations.get(providerId);
		if (waiters) {
			this._pendingRegistrations.delete(providerId);
			waiters.forEach(resolve => resolve());
		}

		const proxy = this._proxy;
		const handlers = this._handlers;
		return new class extends Disposable implements positron.DataExplorerRpcSession {
			constructor() {
				super(() => {
					handlers.delete(providerId);
					proxy.$unregisterRpcHandler(providerId);
				});
			}
			sendUiEvent(event: positron.DataExplorerUiEvent): void {
				proxy.$sendUiEvent(event);
			}
		};
	}

	/**
	 * Opens (or focuses) a Data Explorer for a dataset served by a registered provider.
	 */
	open(options: { providerId: string; datasetId: string; displayName: string }): Promise<void> {
		return Promise.resolve(this._proxy.$open(options.providerId, options.datasetId, options.displayName));
	}

	// --- ExtHostDataExplorerShape (called by the main thread) ---

	async $handleRpc(providerId: string, rpc: IDataExplorerRpcDto): Promise<IDataExplorerResponseDto> {
		const handler = await this._resolveHandler(providerId);
		return handler.handleRpc(rpc as positron.DataExplorerRpcRequest) as Promise<IDataExplorerResponseDto>;
	}

	// --- Private helpers ---

	/**
	 * Returns the handler for a provider, waiting briefly if it hasn't registered yet (the explorer
	 * can be opened before the providing extension finishes activating).
	 */
	private async _resolveHandler(providerId: string): Promise<positron.DataExplorerRpcHandler> {
		const existing = this._handlers.get(providerId);
		if (existing) {
			return existing;
		}

		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => {
				const waiters = this._pendingRegistrations.get(providerId);
				if (waiters) {
					const index = waiters.indexOf(onRegistered);
					if (index !== -1) {
						waiters.splice(index, 1);
					}
				}
				reject(new Error(`Data explorer provider '${providerId}' did not register within ${PROVIDER_REGISTRATION_TIMEOUT_MS / 1000} seconds`));
			}, PROVIDER_REGISTRATION_TIMEOUT_MS);

			const onRegistered = () => {
				clearTimeout(timeout);
				resolve();
			};

			const waiters = this._pendingRegistrations.get(providerId) ?? [];
			waiters.push(onRegistered);
			this._pendingRegistrations.set(providerId, waiters);
		});

		const handler = this._handlers.get(providerId);
		if (!handler) {
			throw new Error(`Data explorer provider '${providerId}' is not registered`);
		}
		return handler;
	}
}

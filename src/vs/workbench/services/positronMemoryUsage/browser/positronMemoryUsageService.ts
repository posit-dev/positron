/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IRuntimeSessionService } from '../../runtimeSession/common/runtimeSessionService.js';
import {
	IMemorySessionUsage,
	IMemoryUsageSnapshot,
	IPositronMemoryInfoProvider,
	IPositronMemoryUsageService,
} from '../../../../platform/positronMemoryUsage/common/positronMemoryUsage.js';

const DEFAULT_POLLING_INTERVAL_MS = 2000;
const POLLING_INTERVAL_SETTING = 'positron.memoryUsage.pollingIntervalMs';

/**
 * Browser-side aggregation service that combines kernel memory events with
 * polled OS/process memory from the provider, and emits periodic snapshots.
 */
export class PositronMemoryUsageService extends Disposable implements IPositronMemoryUsageService {
	readonly _serviceBrand: undefined;

	private readonly _onDidUpdateMemoryUsage = this._register(new Emitter<IMemoryUsageSnapshot>());
	readonly onDidUpdateMemoryUsage: Event<IMemoryUsageSnapshot> = this._onDidUpdateMemoryUsage.event;

	private _currentSnapshot: IMemoryUsageSnapshot | undefined;
	get currentSnapshot(): IMemoryUsageSnapshot | undefined { return this._currentSnapshot; }

	/** Latest kernel memory per session. */
	private readonly _kernelMemory = new Map<string, IMemorySessionUsage>();

	/** Disposables for per-session listeners. */
	private readonly _sessionListeners = new Map<string, DisposableStore>();

	/** Current polling interval handle. */
	private _pollingDisposable: { dispose(): void } | undefined;

	/** Whether the provider is available. */
	private _providerAvailable = true;

	constructor(
		@IPositronMemoryInfoProvider private readonly _provider: IPositronMemoryInfoProvider,
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		// Subscribe to new sessions
		this._register(this._runtimeSessionService.onDidStartRuntime(session => {
			this._addSessionListener(session);
		}));

		// Subscribe to existing sessions
		for (const session of this._runtimeSessionService.activeSessions) {
			this._addSessionListener(session);
		}

		// Clean up when sessions end
		this._register(this._runtimeSessionService.onDidDeleteRuntimeSession(sessionId => {
			this._removeSessionListener(sessionId);
		}));

		// Start polling
		const intervalMs = this._configurationService.getValue<number>(POLLING_INTERVAL_SETTING) || DEFAULT_POLLING_INTERVAL_MS;
		this._startPolling(intervalMs);

		// Listen for config changes
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(POLLING_INTERVAL_SETTING)) {
				const newInterval = this._configurationService.getValue<number>(POLLING_INTERVAL_SETTING) || DEFAULT_POLLING_INTERVAL_MS;
				this._restartPolling(newInterval);
			}
		}));
	}

	private _addSessionListener(session: { sessionId: string; dynState: { sessionName: string }; runtimeMetadata: { runtimeName: string; languageId: string }; onDidUpdateResourceUsage: Event<{ memory_bytes: number }> }): void {
		if (this._sessionListeners.has(session.sessionId)) {
			return;
		}

		const disposables = new DisposableStore();

		disposables.add(session.onDidUpdateResourceUsage(usage => {
			this._kernelMemory.set(session.sessionId, {
				sessionId: session.sessionId,
				sessionName: session.dynState.sessionName || session.runtimeMetadata.runtimeName,
				languageId: session.runtimeMetadata.languageId,
				memoryBytes: usage.memory_bytes,
			});
		}));

		this._sessionListeners.set(session.sessionId, disposables);
	}

	private _removeSessionListener(sessionId: string): void {
		const disposables = this._sessionListeners.get(sessionId);
		if (disposables) {
			disposables.dispose();
			this._sessionListeners.delete(sessionId);
		}
		this._kernelMemory.delete(sessionId);
	}

	private _startPolling(intervalMs: number): void {
		const handle = mainWindow.setInterval(() => this._poll(), intervalMs);
		this._pollingDisposable = toDisposable(() => mainWindow.clearInterval(handle));
		this._register(this._pollingDisposable);
	}

	private _restartPolling(intervalMs: number): void {
		if (this._pollingDisposable) {
			this._pollingDisposable.dispose();
			this._pollingDisposable = undefined;
		}
		this._startPolling(intervalMs);
	}

	private async _poll(): Promise<void> {
		if (!this._providerAvailable) {
			return;
		}

		try {
			const info = await this._provider.getMemoryInfo();

			const kernelSessions = Array.from(this._kernelMemory.values());
			const kernelTotalBytes = kernelSessions.reduce((sum, s) => sum + s.memoryBytes, 0);
			const positronOverheadBytes = info.positronProcessMemory;
			const usedBySystem = info.totalSystemMemory - info.freeSystemMemory;
			const otherProcessesBytes = Math.max(0, usedBySystem - positronOverheadBytes - kernelTotalBytes);

			const snapshot: IMemoryUsageSnapshot = {
				timestamp: Date.now(),
				totalSystemMemory: info.totalSystemMemory,
				freeSystemMemory: info.freeSystemMemory,
				kernelSessions,
				kernelTotalBytes,
				positronOverheadBytes,
				otherProcessesBytes,
			};

			this._currentSnapshot = snapshot;
			this._onDidUpdateMemoryUsage.fire(snapshot);
		} catch (err) {
			// Provider may not be available (e.g., no remote connection)
			this._logService.warn('Failed to poll memory usage:', err);
			this._providerAvailable = false;
		}
	}

	override dispose(): void {
		for (const disposables of this._sessionListeners.values()) {
			disposables.dispose();
		}
		this._sessionListeners.clear();
		this._kernelMemory.clear();
		super.dispose();
	}
}

registerSingleton(IPositronMemoryUsageService, PositronMemoryUsageService, InstantiationType.Delayed);

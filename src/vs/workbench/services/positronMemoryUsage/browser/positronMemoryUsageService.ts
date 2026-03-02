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
import { IHostService } from '../../host/browser/host.js';
import { RuntimeState } from '../../languageRuntime/common/languageRuntimeService.js';
import {
	IMemorySessionUsage,
	IMemoryUsageSnapshot,
	IPositronMemoryInfoProvider,
	IPositronMemoryUsageService,
} from '../../../../platform/positronMemoryUsage/common/positronMemoryUsage.js';

const DEFAULT_POLLING_INTERVAL_MS = 10000;
const UNFOCUSED_POLLING_INTERVAL_MS = 60000;
const POST_EXECUTION_DELAY_MS = 2000;
const POLLING_INTERVAL_SETTING = 'positron.memoryUsage.pollingIntervalMs';

/**
 * Browser-side aggregation service that combines kernel memory events with
 * polled OS/process memory from the provider, and emits periodic snapshots.
 *
 * Polling optimizations:
 * - Uses the configured polling interval when the window is focused (default 10s).
 * - Slows to 60s when the window loses focus.
 * - Schedules an extra poll 2s after all kernels become idle (debounced).
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

	/** Whether the host window currently has focus. */
	private _windowFocused: boolean;

	/** The user-configured polling interval (or default). */
	private _configuredIntervalMs: number;

	/** Handle for the debounced post-execution poll. */
	private _postExecutionTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		@IPositronMemoryInfoProvider private readonly _provider: IPositronMemoryInfoProvider,
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IHostService private readonly _hostService: IHostService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		this._windowFocused = this._hostService.hasFocus;
		this._configuredIntervalMs = this._configurationService.getValue<number>(POLLING_INTERVAL_SETTING) || DEFAULT_POLLING_INTERVAL_MS;

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

		// Schedule a poll after code execution finishes. We listen to the
		// service-level state change event and debounce so that only after
		// all kernels have been idle for POST_EXECUTION_DELAY_MS do we poll.
		this._register(this._runtimeSessionService.onDidChangeRuntimeState(e => {
			if (e.old_state === RuntimeState.Busy && (e.new_state === RuntimeState.Idle || e.new_state === RuntimeState.Ready)) {
				this._schedulePostExecutionPoll();
			}
		}));

		// Start polling with the appropriate interval
		this._startPolling(this._effectiveInterval());

		// Adjust polling when window focus changes
		this._register(this._hostService.onDidChangeFocus(focused => {
			this._windowFocused = focused;
			this._restartPolling(this._effectiveInterval());
			// Poll immediately when regaining focus so the UI updates right away
			if (focused) {
				this._poll();
			}
		}));

		// Listen for config changes
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(POLLING_INTERVAL_SETTING)) {
				this._configuredIntervalMs = this._configurationService.getValue<number>(POLLING_INTERVAL_SETTING) || DEFAULT_POLLING_INTERVAL_MS;
				this._restartPolling(this._effectiveInterval());
			}
		}));
	}

	/**
	 * Returns the polling interval to use based on whether the window is focused.
	 */
	private _effectiveInterval(): number {
		return this._windowFocused ? this._configuredIntervalMs : UNFOCUSED_POLLING_INTERVAL_MS;
	}

	/**
	 * Schedule a single extra poll POST_EXECUTION_DELAY_MS after the last
	 * Busy -> Idle transition. If another kernel goes Busy -> Idle before
	 * the timer fires, the timer is reset (debounce).
	 */
	private _schedulePostExecutionPoll(): void {
		if (this._postExecutionTimer !== undefined) {
			clearTimeout(this._postExecutionTimer);
		}
		this._postExecutionTimer = setTimeout(() => {
			this._postExecutionTimer = undefined;
			this._poll();
		}, POST_EXECUTION_DELAY_MS);
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
		if (this._postExecutionTimer !== undefined) {
			clearTimeout(this._postExecutionTimer);
			this._postExecutionTimer = undefined;
		}
		for (const disposables of this._sessionListeners.values()) {
			disposables.dispose();
		}
		this._sessionListeners.clear();
		this._kernelMemory.clear();
		super.dispose();
	}
}

registerSingleton(IPositronMemoryUsageService, PositronMemoryUsageService, InstantiationType.Delayed);

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
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
const ENABLED_SETTING = 'positron.memoryUsage.enabled';

/** Number of consecutive poll failures before we stop retrying. */
const MAX_CONSECUTIVE_FAILURES = 5;

/**
 * Browser-side aggregation service that combines kernel memory events with
 * polled OS/process memory from the provider, and emits periodic snapshots.
 *
 * Polling optimizations:
 * - Uses the configured polling interval when the window is focused (default 10s).
 * - Slows to 60s when the window loses focus.
 * - Schedules an extra poll 2s after all kernels become idle (debounced).
 *
 * The entire feature can be disabled via the `positron.memoryUsage.enabled`
 * setting. When disabled, polling stops, session listeners are torn down,
 * and the snapshot is cleared. Toggling the setting back on restores the
 * feature immediately.
 */
export class PositronMemoryUsageService extends Disposable implements IPositronMemoryUsageService {
	readonly _serviceBrand: undefined;

	private readonly _onDidUpdateMemoryUsage = this._register(new Emitter<IMemoryUsageSnapshot>());
	readonly onDidUpdateMemoryUsage: Event<IMemoryUsageSnapshot> = this._onDidUpdateMemoryUsage.event;

	private readonly _onDidChangeEnabled = this._register(new Emitter<boolean>());
	readonly onDidChangeEnabled: Event<boolean> = this._onDidChangeEnabled.event;

	private _enabled: boolean;
	get enabled(): boolean { return this._enabled; }

	private _currentSnapshot: IMemoryUsageSnapshot | undefined;
	get currentSnapshot(): IMemoryUsageSnapshot | undefined { return this._currentSnapshot; }

	/** Latest kernel memory per session. */
	private readonly _kernelMemory = new Map<string, IMemorySessionUsage>();

	/** Disposables for per-session listeners. */
	private readonly _sessionListeners = new Map<string, DisposableStore>();

	/** Current polling interval handle. */
	private _pollingDisposable: { dispose(): void } | undefined;

	/** Number of consecutive poll failures. Polling stops after MAX_CONSECUTIVE_FAILURES. */
	private _consecutiveFailures = 0;

	/** Whether the host window currently has focus. */
	private _windowFocused: boolean;

	/** The user-configured polling interval (or default). */
	private _configuredIntervalMs: number;

	/** Disposable for the debounced post-execution poll timer. */
	private _postExecutionTimer: IDisposable | undefined;

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
		this._enabled = this._configurationService.getValue<boolean>(ENABLED_SETTING) !== false;

		// Subscribe to new sessions (guarded by _enabled)
		this._register(this._runtimeSessionService.onDidStartRuntime(session => {
			if (this._enabled) {
				this._addSessionListener(session);
			}
		}));

		// Clean up when sessions end (always safe to call even if not tracked)
		this._register(this._runtimeSessionService.onDidDeleteRuntimeSession(sessionId => {
			this._removeSessionListener(sessionId);
		}));

		// Schedule a poll after code execution finishes. We listen to the
		// service-level state change event and debounce so that only after
		// all kernels have been idle for POST_EXECUTION_DELAY_MS do we poll.
		// When a session exits, clear its memory entry so it no longer
		// appears in the meter. We intentionally keep the event listener
		// alive so that if the session restarts, new resource-usage events
		// will repopulate the entry automatically.
		this._register(this._runtimeSessionService.onDidChangeRuntimeState(e => {
			if (!this._enabled) {
				return;
			}
			if (e.new_state === RuntimeState.Exited) {
				this._kernelMemory.delete(e.session_id);
				this._poll();
			} else if (e.old_state === RuntimeState.Busy && (e.new_state === RuntimeState.Idle || e.new_state === RuntimeState.Ready)) {
				this._schedulePostExecutionPoll();
			}
		}));

		// Adjust polling when window focus changes
		this._register(this._hostService.onDidChangeFocus(focused => {
			this._windowFocused = focused;
			if (!this._enabled) {
				return;
			}
			this._restartPolling(this._effectiveInterval());
			// Poll immediately when regaining focus so the UI updates right away.
			// Also reset the failure counter so a transient error doesn't
			// permanently disable polling.
			if (focused) {
				this._consecutiveFailures = 0;
				this._poll();
			}
		}));

		// Listen for config changes
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(ENABLED_SETTING)) {
				const newEnabled = this._configurationService.getValue<boolean>(ENABLED_SETTING) !== false;
				if (newEnabled !== this._enabled) {
					this._enabled = newEnabled;
					if (newEnabled) {
						this._activate();
					} else {
						this._deactivate();
					}
					this._onDidChangeEnabled.fire(newEnabled);
				}
			}
			if (e.affectsConfiguration(POLLING_INTERVAL_SETTING)) {
				this._configuredIntervalMs = this._configurationService.getValue<number>(POLLING_INTERVAL_SETTING) || DEFAULT_POLLING_INTERVAL_MS;
				if (this._enabled) {
					this._restartPolling(this._effectiveInterval());
				}
			}
		}));

		// Start up if enabled
		if (this._enabled) {
			this._activate();
		}
	}

	/**
	 * Activate the feature: subscribe to existing sessions and start polling.
	 */
	private _activate(): void {
		for (const session of this._runtimeSessionService.activeSessions) {
			this._addSessionListener(session);
		}
		this._consecutiveFailures = 0;
		this._startPolling(this._effectiveInterval());
		this._poll();
	}

	/**
	 * Deactivate the feature: stop polling, dispose session listeners, and
	 * clear all accumulated state.
	 */
	private _deactivate(): void {
		this._stopPolling();
		this._cancelPostExecutionTimer();
		for (const disposables of this._sessionListeners.values()) {
			disposables.dispose();
		}
		this._sessionListeners.clear();
		this._kernelMemory.clear();
		this._currentSnapshot = undefined;
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
		this._cancelPostExecutionTimer();
		const handle = mainWindow.setTimeout(() => {
			this._cancelPostExecutionTimer();
			this._poll();
		}, POST_EXECUTION_DELAY_MS);
		this._postExecutionTimer = toDisposable(() => mainWindow.clearTimeout(handle));
	}

	private _cancelPostExecutionTimer(): void {
		if (this._postExecutionTimer !== undefined) {
			this._postExecutionTimer.dispose();
			this._postExecutionTimer = undefined;
		}
	}

	private _addSessionListener(session: { sessionId: string; dynState: { sessionName: string }; runtimeMetadata: { runtimeName: string; languageId: string }; onDidUpdateResourceUsage: Event<{ memory_bytes: number; process_id?: number }> }): void {
		// Dispose any existing listener for this session. This is necessary
		// when the extension host restarts: the session reconnects with a
		// new object (and new event emitters) but the same sessionId. If
		// we kept the old listener, we would never receive resource-usage
		// events from the reconnected session.
		const existing = this._sessionListeners.get(session.sessionId);
		if (existing) {
			existing.dispose();
			this._sessionListeners.delete(session.sessionId);
		}

		const disposables = new DisposableStore();

		disposables.add(session.onDidUpdateResourceUsage(usage => {
			this._kernelMemory.set(session.sessionId, {
				sessionId: session.sessionId,
				sessionName: session.dynState.sessionName || session.runtimeMetadata.runtimeName,
				languageId: session.runtimeMetadata.languageId,
				memoryBytes: usage.memory_bytes,
				processId: usage.process_id,
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
	}

	private _stopPolling(): void {
		if (this._pollingDisposable) {
			this._pollingDisposable.dispose();
			this._pollingDisposable = undefined;
		}
	}

	private _restartPolling(intervalMs: number): void {
		this._stopPolling();
		this._startPolling(intervalMs);
	}

	private async _poll(): Promise<void> {
		if (this._consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
			return;
		}

		try {
			// Collect known kernel PIDs so the provider can exclude their
			// subtrees from the Positron process memory walk.
			const kernelSessions = Array.from(this._kernelMemory.values());
			const excludePids = kernelSessions
				.map(s => s.processId)
				.filter((pid): pid is number => pid !== undefined && pid > 0);

			const info = await this._provider.getMemoryInfo(
				excludePids.length > 0 ? excludePids : undefined
			);

			// If the feature was disabled while the poll was in-flight, discard the result.
			if (!this._enabled) {
				return;
			}

			// Reset the failure counter on success.
			this._consecutiveFailures = 0;

			const kernelTotalBytes = kernelSessions.reduce((sum, s) => sum + s.memoryBytes, 0);
			const extensionHostOverheadBytes = info.extensionHostMemory;
			const positronOverheadBytes = info.positronProcessMemory;
			const usedBySystem = info.totalSystemMemory - info.freeSystemMemory;
			const otherProcessesBytes = Math.max(0, usedBySystem - positronOverheadBytes - extensionHostOverheadBytes - kernelTotalBytes);

			const snapshot: IMemoryUsageSnapshot = {
				timestamp: Date.now(),
				totalSystemMemory: info.totalSystemMemory,
				freeSystemMemory: info.freeSystemMemory,
				kernelSessions,
				kernelTotalBytes,
				positronOverheadBytes,
				extensionHostOverheadBytes,
				otherProcessesBytes,
			};

			this._currentSnapshot = snapshot;
			this._onDidUpdateMemoryUsage.fire(snapshot);
		} catch (err) {
			this._consecutiveFailures++;
			if (this._consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
				this._logService.warn(`Memory usage polling disabled after ${MAX_CONSECUTIVE_FAILURES} consecutive failures. Will retry on window focus.`, err);
			} else {
				this._logService.warn('Failed to poll memory usage (will retry):', err);
			}
		}
	}

	override dispose(): void {
		this._cancelPostExecutionTimer();
		this._stopPolling();
		for (const disposables of this._sessionListeners.values()) {
			disposables.dispose();
		}
		this._sessionListeners.clear();
		this._kernelMemory.clear();
		super.dispose();
	}
}

registerSingleton(IPositronMemoryUsageService, PositronMemoryUsageService, InstantiationType.Delayed);

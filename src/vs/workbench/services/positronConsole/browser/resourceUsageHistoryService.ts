/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { IEphemeralStateService } from '../../../../platform/ephemeralState/common/ephemeralState.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ILanguageRuntimeResourceUsage } from '../../languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../runtimeSession/common/runtimeSessionService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';

/**
 * The maximum number of resource usage data points to keep in history per session.
 * At typical 1 sample/sec and 2px per point, 600 points supports 1200px width.
 */
export const MAX_RESOURCE_USAGE_HISTORY = 600;

/**
 * The prefix for ephemeral storage keys for resource usage history.
 */
const RESOURCE_USAGE_HISTORY_KEY_PREFIX = 'positron.console.resourceUsageHistory';

/**
 * Creates the decorator for dependency injection.
 */
export const IResourceUsageHistoryService = createDecorator<IResourceUsageHistoryService>('resourceUsageHistoryService');

/**
 * Interface for the resource usage history service.
 */
export interface IResourceUsageHistoryService {
	readonly _serviceBrand: undefined;

	/**
	 * Gets the resource usage history for a session.
	 *
	 * @param sessionId The session ID.
	 * @returns The resource usage history for the session.
	 */
	getHistory(sessionId: string): Promise<ILanguageRuntimeResourceUsage[]>;

	/**
	 * Clears the resource usage history for a session.
	 *
	 * @param sessionId The session ID.
	 */
	clearHistory(sessionId: string): Promise<void>;
}

/**
 * Service that manages resource usage history for sessions.
 * History is stored in ephemeral state so it survives browser reloads.
 */
export class ResourceUsageHistoryService extends Disposable implements IResourceUsageHistoryService {
	readonly _serviceBrand: undefined;

	/**
	 * In-memory cache of resource usage history per session.
	 * The cache is keyed by session ID.
	 */
	private readonly _historyCache = new Map<string, ILanguageRuntimeResourceUsage[]>();

	/**
	 * Track pending save promises to avoid race conditions.
	 */
	private readonly _pendingSaves = new Map<string, Promise<void>>();

	/**
	 * Disposable store for session listeners.
	 */
	private readonly _sessionListeners = new Map<string, DisposableStore>();

	constructor(
		@IEphemeralStateService private readonly _ephemeralStateService: IEphemeralStateService,
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		// Add listener for sessions that start, to listen for resource usage updates
		this._register(this._runtimeSessionService.onDidStartRuntime(session => {
			this.addSessionListener(session);
		}));

		// Add listeners for existing sessions
		for (const sessionInfo of this._runtimeSessionService.activeSessions) {
			const session = this._runtimeSessionService.getSession(sessionInfo.sessionId);
			if (session) {
				this.addSessionListener(session);
			}
		}

		// Clean up session listeners when sessions are deleted
		this._register(this._runtimeSessionService.onDidDeleteRuntimeSession(sessionId => {
			this.removeSessionListener(sessionId);
		}));
	}

	/**
	 * Gets the ephemeral state key for a session's resource usage history.
	 *
	 * @param sessionId The session ID.
	 * @returns The ephemeral state key.
	 */
	private getStorageKey(sessionId: string): string {
		const workspaceId = this._workspaceContextService.getWorkspace().id;
		return `${RESOURCE_USAGE_HISTORY_KEY_PREFIX}.${workspaceId}.${sessionId}`;
	}

	/**
	 * Adds a listener for resource usage updates from a session.
	 *
	 * @param session The runtime session.
	 */
	private addSessionListener(session: ILanguageRuntimeSession): void {
		// Skip if we already have a listener for this session
		if (this._sessionListeners.has(session.sessionId)) {
			return;
		}

		const disposables = new DisposableStore();

		// Listen for resource usage updates
		disposables.add(session.onDidUpdateResourceUsage(usage => {
			this.addResourceUsage(session.sessionId, usage);
		}));

		this._sessionListeners.set(session.sessionId, disposables);
	}

	/**
	 * Removes the listener for a session.
	 *
	 * @param sessionId The session ID.
	 */
	private removeSessionListener(sessionId: string): void {
		const disposables = this._sessionListeners.get(sessionId);
		if (disposables) {
			disposables.dispose();
			this._sessionListeners.delete(sessionId);
		}
	}

	/**
	 * Adds a resource usage data point to the history for a session.
	 *
	 * @param sessionId The session ID.
	 * @param usage The resource usage data.
	 */
	private addResourceUsage(sessionId: string, usage: ILanguageRuntimeResourceUsage): void {
		// Get existing history from cache or initialize empty array
		let history = this._historyCache.get(sessionId);
		if (!history) {
			history = [];
			this._historyCache.set(sessionId, history);
		}

		// Add new data point
		history.push(usage);

		// If we exceed the max, remove old entries efficiently
		if (history.length > MAX_RESOURCE_USAGE_HISTORY) {
			// Remove oldest entries to get back to max size
			const excess = history.length - MAX_RESOURCE_USAGE_HISTORY;
			history.splice(0, excess);
		}

		// Save to ephemeral state (debounced via promise tracking)
		this.saveHistory(sessionId);
	}

	/**
	 * Saves the history for a session to ephemeral state.
	 * Uses promise tracking to avoid race conditions.
	 *
	 * @param sessionId The session ID.
	 */
	private async saveHistory(sessionId: string): Promise<void> {
		// Wait for any pending save to complete
		const pending = this._pendingSaves.get(sessionId);
		if (pending) {
			await pending;
		}

		const history = this._historyCache.get(sessionId);
		if (!history) {
			return;
		}

		const key = this.getStorageKey(sessionId);
		const savePromise = this._ephemeralStateService.setItem(key, history).catch(err => {
			this._logService.warn(`Failed to save resource usage history for session ${sessionId}: ${err}`);
		});

		this._pendingSaves.set(sessionId, savePromise);

		try {
			await savePromise;
		} finally {
			// Only delete if this is still our promise
			if (this._pendingSaves.get(sessionId) === savePromise) {
				this._pendingSaves.delete(sessionId);
			}
		}
	}

	/**
	 * Gets the resource usage history for a session.
	 *
	 * @param sessionId The session ID.
	 * @returns The resource usage history.
	 */
	async getHistory(sessionId: string): Promise<ILanguageRuntimeResourceUsage[]> {
		// Check cache first
		const cached = this._historyCache.get(sessionId);
		if (cached) {
			return [...cached];
		}

		// Load from ephemeral state
		const key = this.getStorageKey(sessionId);
		try {
			const history = await this._ephemeralStateService.getItem<ILanguageRuntimeResourceUsage[]>(key);
			if (history && Array.isArray(history)) {
				// Cache the loaded history
				this._historyCache.set(sessionId, history);
				return [...history];
			}
		} catch (err) {
			this._logService.warn(`Failed to load resource usage history for session ${sessionId}: ${err}`);
		}

		return [];
	}

	/**
	 * Clears the resource usage history for a session.
	 *
	 * @param sessionId The session ID.
	 */
	async clearHistory(sessionId: string): Promise<void> {
		// Clear from cache
		this._historyCache.delete(sessionId);

		// Clear from ephemeral state
		const key = this.getStorageKey(sessionId);
		try {
			await this._ephemeralStateService.removeItem(key);
		} catch (err) {
			this._logService.warn(`Failed to clear resource usage history for session ${sessionId}: ${err}`);
		}
	}

	override dispose(): void {
		// Clean up all session listeners
		for (const disposables of this._sessionListeners.values()) {
			disposables.dispose();
		}
		this._sessionListeners.clear();
		this._historyCache.clear();
		this._pendingSaves.clear();
		super.dispose();
	}
}

// Register the singleton
registerSingleton(IResourceUsageHistoryService, ResourceUsageHistoryService, InstantiationType.Delayed);

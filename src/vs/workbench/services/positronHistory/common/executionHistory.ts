/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { EXECUTION_HISTORY_STORAGE_PREFIX, IExecutionHistoryEntry, IExecutionHistoryService, IInputHistoryEntry, INPUT_HISTORY_STORAGE_PREFIX } from './executionHistoryService.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILanguageRuntimeSession, IRuntimeSessionService, RuntimeStartMode } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { SessionExecutionHistory } from './sessionExecutionHistory.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IRuntimeStartupService, SerializedSessionMetadata } from '../../runtimeStartup/common/runtimeStartupService.js';
import { RuntimeExitReason } from '../../languageRuntime/common/languageRuntimeService.js';
import { SessionInputHistory } from './sessionInputHistory.js';
import { LanguageInputHistory } from './languageInputHistory.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';

/**
 * Service that manages execution and input histories for all runtimes.
 *
 * This service is responsible for maintaining three separate types of history:
 *
 * - Session execution history: a history of all code executions in a given
 *   runtime session. This is the largest but most ephemeral history; it is
 *   saved, but can be cleared just by clearing the console.
 *
 * - Session input history: a history of all inputs in a given runtime session.
 *   This is used to recall history when navigating in the console.
 *
 * - Language input history: a history of all inputs for a given language. This
 *   is used to drive history search operations.
 */
export class ExecutionHistoryService extends Disposable implements IExecutionHistoryService {
	// Required for service branding in dependency injector.
	_serviceBrand: undefined;

	// Map of session ID to execution history
	private readonly _executionHistories: Map<string, SessionExecutionHistory> = new Map();

	// Map of session ID to input history
	private readonly _sessionHistories: Map<string, SessionInputHistory> = new Map();

	// Map of language ID to input history
	private readonly _languageHistories: Map<string, LanguageInputHistory> = new Map();

	constructor(
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
		@IRuntimeStartupService private readonly _runtimeStartupService: IRuntimeStartupService,
		@IStorageService private readonly _storageService: IStorageService,
		@ILogService private readonly _logService: ILogService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService
	) {
		super();

		// Start recording history for all currently active runtimes
		this._runtimeSessionService.activeSessions.forEach(session => {
			this.beginRecordingHistory(session, RuntimeStartMode.Reconnecting);
		});

		// Listen for runtimes to start; when they do, begin recording
		// executions
		this._register(this._runtimeSessionService.onWillStartSession(evt => {
			this.beginRecordingHistory(evt.session, evt.startMode);
		}));

		// When a session fails to restore, delete any history that was stored
		// with the session.
		this._register(this._runtimeStartupService.onSessionRestoreFailure(evt => {
			this.deleteSessionHistory(evt.sessionId);
		}));

		// Prune storage for any sessions that are no longer active
		this._runtimeStartupService.getRestoredSessions().then(sessions => {
			this.pruneStorage(sessions);
		});
	}

	/**
	 * Clear the input history for the given session
	 *
	 * @param sessionId Language ID to clear input history for
	 */
	clearInputEntries(sessionId: string): void {
		if (this._sessionHistories.has(sessionId)) {
			this._sessionHistories.get(sessionId)!.delete();
		}
	}

	/**
	 * Prunes the storage of any history entries that don't have a corresponding session.
	 *
	 * @param sessions The set of sessions that have been or will be restored
	 */
	pruneStorage(sessions: SerializedSessionMetadata[]): void {
		// The set of session IDs that we have restored, or will restore
		const restoredSessionIds = sessions.map(session => session.metadata.sessionId);

		// The set of session IDs that are currently active
		const activeSessionIds = Array.from(this._executionHistories.keys());

		// All valid session IDs
		const allSessionIds = new Set([...restoredSessionIds, ...activeSessionIds]);

		// Get the set of all history and input keys in storage
		const historyKeys = this._storageService
			.keys(StorageScope.WORKSPACE, StorageTarget.MACHINE)
			.filter(key => key.startsWith(EXECUTION_HISTORY_STORAGE_PREFIX));
		const inputKeys = this._storageService
			.keys(StorageScope.WORKSPACE, StorageTarget.MACHINE)
			.filter(key => key.startsWith(INPUT_HISTORY_STORAGE_PREFIX));
		historyKeys.push(...inputKeys);

		// Prune any history entries that don't have a corresponding session
		historyKeys.forEach(key => {
			// Ignore malformed keys (no session ID)
			const parts = key.split('.');
			if (parts.length < 3) {
				return;
			}
			// Extract the session ID from the key
			const sessionId = parts[2];
			if (!allSessionIds.has(sessionId)) {
				this._logService.debug(
					`[Runtime history] Pruning ${key} for expired session ${sessionId}`);
				this._storageService.remove(key, StorageScope.WORKSPACE);
			}
		});
	}

	/**
	 * Get the input history for the given session.
	 *
	 * @param sessionId Session ID to get input history for
	 * @returns Input history for the given session, as an array of input history entries.
	 */
	getSessionInputEntries(sessionId: string): IInputHistoryEntry[] {
		if (this._sessionHistories.has(sessionId)) {
			return this._sessionHistories.get(sessionId)!.getInputHistory();
		} else {
			const history = new SessionInputHistory(sessionId,
				this._storageService,
				this._logService);
			this._sessionHistories.set(sessionId, history);
			this._register(history);
			return history.getInputHistory();
		}
	}

	/**
	 * Get the input history for the given language.
	 *
	 * @param language Language ID to get input history for
	 * @returns Input history for the given language, as an array of input history entries.
	 */
	getInputEntries(languageId: string): IInputHistoryEntry[] {
		return this.getLanguageHistory(languageId)?.getInputHistory() || [];
	}

	/**
	 * Attempt to get the language history for a given language ID. If the history
	 * doesn't exist, create it.
	 *
	 * @param languageId The ID of the language to get input history for
	 * @returns The language history, if it exists or could be created, or
	 * undefined otherwise.
	 *
	 * Does not throw.
	 */
	private getLanguageHistory(languageId: string): LanguageInputHistory | undefined {
		// If we already have a history for this language, return it
		if (this._languageHistories.has(languageId)) {
			return this._languageHistories.get(languageId)!;
		}

		// We don't have a history for this language, so create one
		try {
			// Use the workspace scope if we have a workspace, otherwise use
			// the profile scope (this handles the empty workspace case)
			const storageScope =
				this._workspaceContextService.getWorkbenchState() === WorkbenchState.EMPTY ?
					StorageScope.PROFILE :
					StorageScope.WORKSPACE;

			// Create the history
			const history = new LanguageInputHistory(
				languageId,
				this._storageService,
				storageScope,
				this._logService,
				this._configurationService);

			// Store the history and return it
			this._languageHistories.set(languageId, history);
			this._register(history);
			return history;
		} catch (e) {
			this._logService.error(`Error creating language history for ${languageId}: ${e}`);
		}
		return undefined;
	}

	/**
	 * Begins recording history for a given runtime session.
	 *
	 * @param session The session to begin recording history for.
	 * @param startMode The mode in which the session is starting.
	 */
	private beginRecordingHistory(session: ILanguageRuntimeSession, startMode: RuntimeStartMode): void {
		// Attach the session to the language history
		this.getLanguageHistory(session.runtimeMetadata.languageId)?.attachSession(session);

		// Create a new history for the runtime if we don't already have one
		if (this._executionHistories.has(session.sessionId)) {
			const history = this._executionHistories.get(session.sessionId);
			history!.attachSession(session);
		} else {
			const history = new SessionExecutionHistory(
				session.metadata.sessionId,
				startMode,
				this._storageService,
				this._logService);
			history.attachSession(session);
			this._executionHistories.set(session.sessionId, history);
			this._register(history);
		}

		if (this._sessionHistories.has(session.sessionId)) {
			const input = this._sessionHistories.get(session.sessionId);
			input!.attachSession(session);
		} else {
			const input = new SessionInputHistory(
				session.sessionId,
				this._storageService,
				this._logService);
			input.attachSession(session);
			this._sessionHistories.set(session.sessionId, input);
			this._register(input);
		}

		// Clean up the history when the session ends
		this._register(session.onDidEndSession(evt => {

			// Some session exit reasons indicate permanent termination, so we should
			// clean up the history in those cases.
			//
			// Note that this is largely for hygiene and storage conservation;
			// the history is also pruned at startup for any sessions that are
			// no longer active, so anything missed here will be cleaned up at
			// the next startup.
			if (evt.reason === RuntimeExitReason.Shutdown ||
				evt.reason === RuntimeExitReason.ForcedQuit ||
				evt.reason === RuntimeExitReason.Unknown) {
				this.deleteSessionHistory(session.sessionId);
			}
		}));
	}

	/**
	 * Permanently delete the input and execution history for a given session.
	 *
	 * This is done when the session ends or fails to restore.
	 *
	 * @param sessionId
	 */
	deleteSessionHistory(sessionId: string) {
		if (this._executionHistories.has(sessionId)) {
			const history = this._executionHistories.get(sessionId)!;
			history.delete();
			history.dispose();
			this._executionHistories.delete(sessionId);
		}
		if (this._sessionHistories.has(sessionId)) {
			const input = this._sessionHistories.get(sessionId)!;
			input.delete();
			input.dispose();
			this._sessionHistories.delete(sessionId);
		}
	}

	/**
	 * Gets the execution history for a given runtime session.
	 *
	 * @param sessionId The ID of the session to get execution history for.
	 * @returns An array of history entries.
	 */
	getExecutionEntries(sessionId: string): IExecutionHistoryEntry<any>[] {
		// Return the history entries for the given runtime, if known.
		if (this._executionHistories.has(sessionId)) {
			return this._executionHistories.get(sessionId)?.entries!;
		}

		// If we don't have a history for this session, create one.
		const history = new SessionExecutionHistory(
			sessionId,
			RuntimeStartMode.Reconnecting,
			this._storageService,
			this._logService);
		this._executionHistories.set(sessionId, history);
		this._register(history);
		return history.entries;
	}

	clearExecutionEntries(runtimeId: string): void {
		// Return the history entries for the given runtime, if known.
		if (this._executionHistories.has(runtimeId)) {
			this._executionHistories.get(runtimeId)?.clear();
		} else {
			throw new Error(`Can't get entries; unknown runtime ID: ${runtimeId}`);
		}
	}
}

registerSingleton(IExecutionHistoryService, ExecutionHistoryService, InstantiationType.Delayed);

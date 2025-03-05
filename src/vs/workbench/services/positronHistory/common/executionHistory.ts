/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IExecutionHistoryEntry, IExecutionHistoryService, IInputHistoryEntry } from './executionHistoryService.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { IStorageService, StorageScope } from '../../../../platform/storage/common/storage.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { RuntimeExecutionHistory } from './runtimeExecutionHistory.js';
import { LanguageInputHistory } from './languageInputHistory.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';

/**
 * Service that manages execution histories for all runtimes.
 */
export class ExecutionHistoryService extends Disposable implements IExecutionHistoryService {
	// Required for service branding in dependency injector.
	_serviceBrand: undefined;

	// Map of runtime ID to execution history
	private readonly _executionHistories: Map<string, RuntimeExecutionHistory> = new Map();

	// Map of language ID to input history
	private readonly _inputHistories: Map<string, LanguageInputHistory> = new Map();

	constructor(
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
		@IStorageService private readonly _storageService: IStorageService,
		@ILogService private readonly _logService: ILogService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService
	) {
		super();

		// Start recording history for all currently active runtimes
		this._runtimeSessionService.activeSessions.forEach(session => {
			this.beginRecordingHistory(session);
		});

		// Listen for runtimes to start; when they do, begin recording
		// executions
		this._register(this._runtimeSessionService.onDidStartRuntime(runtime => {
			this.beginRecordingHistory(runtime);
		}));
	}

	/**
	 * Clear the input history for the given language (remove all entries)
	 *
	 * @param languageId Language ID to clear input history for
	 */
	clearInputEntries(languageId: string): void {
		this.getInputHistory(languageId).clear();
	}

	/**
	 * Get the input history for the given language.
	 *
	 * @param languageId Language ID to get input history for
	 * @returns Input history for the given language, as an array of input history entries.
	 */
	getInputEntries(languageId: string): IInputHistoryEntry[] {
		return this.getInputHistory(languageId).getInputHistory();
	}

	private beginRecordingHistory(runtime: ILanguageRuntimeSession): void {
		// Create a new history for the runtime if we don't already have one
		if (!this._executionHistories.has(runtime.runtimeMetadata.runtimeId)) {
			const history = new RuntimeExecutionHistory(runtime, this._storageService, this._logService);
			this._executionHistories.set(runtime.runtimeMetadata.runtimeId, history);
			this._register(history);
		}

		// Attach the runtime to an input history recorder for the language,
		// creating one if necessary
		this.getInputHistory(runtime.runtimeMetadata.languageId).attachToRuntime(runtime);
	}

	getExecutionEntries(runtimeId: string): IExecutionHistoryEntry<any>[] {
		// Return the history entries for the given runtime, if known.
		if (this._executionHistories.has(runtimeId)) {
			return this._executionHistories.get(runtimeId)?.entries!;
		} else {
			throw new Error(`Can't get entries; unknown runtime ID: ${runtimeId}`);
		}
	}

	clearExecutionEntries(runtimeId: string): void {
		// Return the history entries for the given runtime, if known.
		if (this._executionHistories.has(runtimeId)) {
			this._executionHistories.get(runtimeId)?.clear();
		} else {
			throw new Error(`Can't get entries; unknown runtime ID: ${runtimeId}`);
		}
	}

	/**
	 * Gets the input history for the given language ID, creating it if necessary.
	 *
	 * @param languageId The language ID for which to get the input history
	 * @param callback The callback to execute with the input history
	 */
	private getInputHistory(languageId: string): LanguageInputHistory {
		if (this._inputHistories.has(languageId)) {
			return this._inputHistories.get(languageId)!;
		}

		// If we're in an empty workspace, use the profile storage scope; otherwise,
		// use the workspace scope.
		const storageScope =
			this._workspaceContextService.getWorkbenchState() === WorkbenchState.EMPTY ?
				StorageScope.PROFILE :
				StorageScope.WORKSPACE;
		const history = new LanguageInputHistory(languageId,
			this._storageService,
			storageScope,
			this._logService,
			this._configurationService);
		this._inputHistories.set(languageId, history);
		this._register(history);
		return history;
	}
}

registerSingleton(IExecutionHistoryService, ExecutionHistoryService, InstantiationType.Delayed);

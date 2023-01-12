/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { IExecutionHistoryEntry, IExecutionHistoryService, IInputHistoryEntry } from 'vs/workbench/contrib/executionHistory/common/executionHistoryService';

import { Disposable } from 'vs/base/common/lifecycle';
import { ILanguageRuntime, ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { ILogService } from 'vs/platform/log/common/log';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { RuntimeExecutionHistory } from 'vs/workbench/contrib/executionHistory/common/runtimeExecutionHistory';
import { LanguageInputHistory } from 'vs/workbench/contrib/executionHistory/common/languageInputHistory';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';

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
		@ILanguageRuntimeService private readonly _languageRuntimeService: ILanguageRuntimeService,
		@IStorageService private readonly _storageService: IStorageService,
		@ILogService private readonly _logService: ILogService,
		@IConfigurationService private readonly _configurationService: IConfigurationService
	) {
		super();

		// Start recording history for all currently active runtimes
		this._languageRuntimeService.runningRuntimes.forEach(runtime => {
			this.beginRecordingHistory(runtime);
		});

		// Listen for runtimes to start; when they do, begin recording
		// executions
		this._languageRuntimeService.onDidStartRuntime(runtime => {
			this.beginRecordingHistory(runtime);
		});
	}

	getInputEntries(languageId: string): IInputHistoryEntry[] {
		if (this._inputHistories.has(languageId)) {
			// We have a live input history recorder for this language; ask it for entries
			return this._inputHistories.get(languageId)?.getInputHistory() || [];
		} else {
			// No live input history recorder; try to load from storage (and
			// cache the input history recorder for later use)
			const history = new LanguageInputHistory(languageId, this._storageService, this._logService, this._configurationService);
			this._inputHistories.set(languageId, history);
			return history.getInputHistory();
		}
	}

	private beginRecordingHistory(runtime: ILanguageRuntime): void {
		// Create a new history for the runtime if we don't already have one
		if (!this._executionHistories.has(runtime.metadata.id)) {
			const history = new RuntimeExecutionHistory(runtime, this._storageService, this._logService);
			this._executionHistories.set(runtime.metadata.id, history);
			this._register(history);
		}

		// Same for the input history of the associated language
		if (this._inputHistories.has(runtime.metadata.language)) {
			// If we already have an input history, attach the runtime to it
			const history = this._inputHistories.get(runtime.metadata.language);
			history?.attachToRuntime(runtime);
		} else {
			// Don't have an input history yet; create one and attach the runtime
			const history = new LanguageInputHistory(runtime.metadata.language, this._storageService, this._logService, this._configurationService);
			history.attachToRuntime(runtime);
			this._inputHistories.set(runtime.metadata.language, history);
			this._register(history);
		}
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
}

registerSingleton(IExecutionHistoryService, ExecutionHistoryService, InstantiationType.Delayed);

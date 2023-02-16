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

	private beginRecordingHistory(runtime: ILanguageRuntime): void {
		// Create a new history for the runtime if we don't already have one
		if (!this._executionHistories.has(runtime.metadata.runtimeId)) {
			const history = new RuntimeExecutionHistory(runtime, this._storageService, this._logService);
			this._executionHistories.set(runtime.metadata.runtimeId, history);
			this._register(history);
		}

		// Attach the runtime to an input history recorder for the language,
		// creating one if necessary
		this.getInputHistory(runtime.metadata.languageId).attachToRuntime(runtime);
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
		const history = new LanguageInputHistory(languageId, this._storageService, this._logService, this._configurationService);
		this._inputHistories.set(languageId, history);
		this._register(history);
		return history;
	}
}

registerSingleton(IExecutionHistoryService, ExecutionHistoryService, InstantiationType.Delayed);

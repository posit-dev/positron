/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { IExecutionHistoryEntry, IExecutionHistoryService } from 'vs/workbench/services/executionHistory/common/executionHistoryService';

import { Disposable } from 'vs/base/common/lifecycle';
import { ILanguageRuntime, ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { ILogService } from 'vs/platform/log/common/log';

export class RuntimeExecutionHistory extends Disposable {
	private readonly _entries: IExecutionHistoryEntry[] = [];
	private readonly _storageKey: string;
	private _timerId?: NodeJS.Timeout;

	constructor(
		private readonly _runtime: ILanguageRuntime,
		private readonly _storageService: IStorageService,
		private readonly _logService: ILogService
	) {
		super();

		// Create storage key
		this._storageKey = `positron.executionHistory.${_runtime.metadata.id}`;

		// Load existing history entries
		const entries = this._storageService.get(this._storageKey, StorageScope.WORKSPACE, '[]');
		try {
			JSON.parse(entries).forEach((entry: IExecutionHistoryEntry) => {
				this._entries.push(entry);
			});
		} catch (err) {
			this._logService.warn(`Couldn't load history for ${this._runtime.metadata.name} ${this._runtime.metadata.id}: ${err}}`)
		}

		// Listen for execution events
		this._register(this._runtime.onDidReceiveRuntimeMessage(message => {
			// TODO: This is where we create history entries
			this.delayedSave();
		}));

		// Ensure we persist the history on e.g. shutdown
		this._register(this._storageService.onWillSaveState(() => {
			this.save();
		}));
	}

	get entries(): IExecutionHistoryEntry[] {
		return this._entries;
	}

	/**
	 * Save the history entries to storage after a delay. The history can become
	 * somewhat large, so we don't want to save it synchronously during every
	 * execution.
	 */
	private delayedSave(): void {
		// Reset any existing timer
		if (this._timerId) {
			clearTimeout(this._timerId);
			this._timerId = undefined;
		}

		// Set a new 30 second timer
		this._timerId = setTimeout(() => {
			this.save();
		}, 30000);
	}

	private save(): void {
		// Reset the timer if it's still running
		if (this._timerId) {
			clearTimeout(this._timerId);
			this._timerId = undefined;
		}

		this._storageService.store(this._storageKey,
			JSON.stringify(this._entries),
			StorageScope.WORKSPACE,
			StorageTarget.MACHINE);
	}
}

export class ExecutionHistoryService extends Disposable implements IExecutionHistoryService {
	// Required for service branding in dependency injector.
	_serviceBrand: undefined;

	// Map of runtime ID to execution history
	private readonly _histories: Map<string, RuntimeExecutionHistory> = new Map();

	constructor(
		@ILanguageRuntimeService private readonly _languageRuntimeService: ILanguageRuntimeService,
		@IStorageService private readonly _storageService: IStorageService,
		@ILogService private readonly _logService: ILogService
	) {
		super();

		// Listen for runtimes to start; when they do, begin recording executions
		this._languageRuntimeService.onDidStartRuntime(runtime => {
			// Ensure we don't already have a history for this runtime
			if (this._histories.has(runtime.metadata.id)) {
				// Already have a history for this runtime
				return;
			}

			// Create a new history for the runtime
			const history = new RuntimeExecutionHistory(runtime, this._storageService, this._logService);
			this._histories.set(runtime.metadata.id, history);
			this._register(history);
		});
	}

	getEntries(runtimeId: string): Promise<IExecutionHistoryEntry[]> {
		// Return the history entries for the given runtime, if known.
		if (this._histories.has(runtimeId)) {
			return Promise.resolve(this._histories.get(runtimeId)?.entries!);
		} else {
			return Promise.reject(`Unknown runtime ID: ${runtimeId}`);
		}
	}
}

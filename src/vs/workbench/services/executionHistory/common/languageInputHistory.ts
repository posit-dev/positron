/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { ILogService } from 'vs/platform/log/common/log';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { IInputHistoryEntry } from 'vs/workbench/services/executionHistory/common/executionHistoryService';
import { ILanguageRuntime } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

/**
 * Records input history for a given language. This is a separate class from the
 * runtime execution history because the input history is language-specific,
 * whereas the execution history is runtime-specific.
 *
 * Because multiple runtimes may be associated with the same language, each must
 * be attached individually.
 */
export class LanguageInputHistory extends Disposable {
	/** The set of runtime IDs to which we are currently attached (listening to inputs) */
	private _attachedRuntimes: Set<string> = new Set();

	/** The set of entries that have not been flushed to storage  */
	private readonly _pendingEntries: IInputHistoryEntry[] = [];

	/** The unique storage key used to persist entries */
	private readonly _storageKey: string;

	/** The timer used to debounce writes to the history */
	private _timerId?: NodeJS.Timeout;

	constructor(
		private readonly _languageId: string,
		private readonly _storageService: IStorageService,
		private readonly _logService: ILogService) {
		super();

		// The storage key is unique to the language ID.
		this._storageKey = `positron.languageInputHistory.${this._languageId}`;
	}

	public attachToRuntime(runtime: ILanguageRuntime): void {
		// Don't attach to the same runtime twice.
		if (this._attachedRuntimes.has(runtime.metadata.id)) {
			this._logService.debug(`LanguageInputHistory: Already attached to runtime ${runtime.metadata.id}`);
			return;
		}

		// Safety check: ensure that this runtime is associated with the
		// language for this history recorder.
		if (runtime.metadata.language !== this._languageId) {
			this._logService.warn(`LanguageInputHistory: Language mismatch (expected ${this._languageId}, got ${runtime.metadata.language}))`);
			return;
		}

		// When a runtime records an input, emit it to the history.
		this._register(runtime.onDidReceiveRuntimeMessageInput(message => {
			const entry: IInputHistoryEntry = {
				when: Date.now(),
				input: message.code
			};
			this._pendingEntries.push(entry);
			this.save();
		}));
	}

	private save(): void {
		// Reset the timer if it's still running
		if (this._timerId) {
			clearTimeout(this._timerId);
			this._timerId = undefined;
		}

		// Read the existing entries. We do this every time we save because
		// another instance of the app may have written to the same storage.
		const entries = this._storageService.get(this._storageKey, StorageScope.PROFILE, '[]');
		let parsedEntries: IInputHistoryEntry[] = [];
		try {
			parsedEntries = JSON.parse(entries);
		} catch (err) {
			// If we can't parse the JSON, the storage is corrupt, so we can't
			// meaningfully do anything with it. We'll start over with a fresh
			// input history.
			this._logService.error(`LanguageInputHistory: Failed to parse JSON from storage: ${err}. Resetting input history.`);
		}

		// Serialize the entries to JSON and write them to storage.
		const storageState = JSON.stringify(parsedEntries.concat(this._pendingEntries));
		this._logService.trace(`Saving input history in key ${this._storageKey} (${storageState.length} bytes)`);

		// Write to machine/workspace specific storage so we can restore the
		// history in this "session"
		this._storageService.store(this._storageKey,
			storageState,
			StorageScope.PROFILE,
			StorageTarget.USER);
	}
}

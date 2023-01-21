/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ILogService } from 'vs/platform/log/common/log';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { IInputHistoryEntry, inputHistorySizeSettingId } from 'vs/workbench/contrib/executionHistory/common/executionHistoryService';
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
		private readonly _logService: ILogService,
		private readonly _configurationService: IConfigurationService) {
		super();

		// The storage key is unique to the language ID.
		this._storageKey = `positron.languageInputHistory.${this._languageId}`;

		// Ensure that any pending entries are flushed to storage during
		// shutdown.
		this._register(this._storageService.onWillSaveState(() => {
			this.save(true);
		}));
	}

	public attachToRuntime(runtime: ILanguageRuntime): void {
		// Don't attach to the same runtime twice.
		if (this._attachedRuntimes.has(runtime.metadata.id)) {
			this._logService.debug(`LanguageInputHistory (${this._languageId}): Already attached to runtime ${runtime.metadata.id}`);
			return;
		}

		// Safety check: ensure that this runtime is associated with the
		// language for this history recorder.
		if (runtime.metadata.language !== this._languageId) {
			this._logService.warn(`LanguageInputHistory (${this._languageId}): Language mismatch (expected ${this._languageId}, got ${runtime.metadata.language}))`);
			return;
		}

		// When a runtime records an input, emit it to the history.
		this._register(runtime.onDidReceiveRuntimeMessageInput(message => {
			const entry: IInputHistoryEntry = {
				when: Date.parse(message.when),
				input: message.code
			};
			this._pendingEntries.push(entry);
			this.delayedSave();
		}));
	}

	/**
	 * Save the input history entries to storage after a delay. The history can
	 * become somewhat large, so we don't want to save it synchronously during
	 * every execution.
	 */
	private delayedSave(): void {
		this.clearSaveTimer();

		// Set a new 10 second timer
		this._timerId = setTimeout(() => {
			this.save(false);
		}, 10000);
	}

	/**
	 * Gets the input history entries for this language.
	 *
	 * @returns The input history entries for this language.
	 */
	public getInputHistory(): IInputHistoryEntry[] {
		// Read the existing entries from storage.
		const entries = this._storageService.get(this._storageKey, StorageScope.PROFILE, '[]');
		let parsedEntries: IInputHistoryEntry[] = [];
		try {
			parsedEntries = JSON.parse(entries);
		} catch (err) {
			this._logService.error(`LanguageInputHistory (${this._languageId}): Failed to parse JSON from storage: ${err}.`);
		}

		// Return the parsed entries, plus any pending entries that have not yet
		// been saved.
		return parsedEntries.concat(this._pendingEntries);
	}

	/**
	 * Clears the input history for this language.
	 */
	public clear() {
		// Clear any running save timer
		this.clearSaveTimer();

		// Clear any pending entries to ensure they never get flushed to storage
		this._pendingEntries.splice(0, this._pendingEntries.length);

		// Clear the underlying storage
		this._storageService.remove(this._storageKey, StorageScope.PROFILE);
	}

	private save(forShutdown: boolean): void {
		// Clear any running save timer
		this.clearSaveTimer();

		if (this._pendingEntries.length === 0) {
			// Nothing to save
			return;
		}

		// Read the existing entries. We do this every time we save because
		// another instance of the app may have written to the same storage.
		const entries = this._storageService.get(this._storageKey, StorageScope.PROFILE, '[]');
		let parsedEntries: IInputHistoryEntry[] = [];
		try {
			parsedEntries = JSON.parse(entries);
		} catch (err) {
			// If we can't parse the JSON, the storage is corrupt, so we can't
			// meaningfully do anything with it.
			this._logService.error(`LanguageInputHistory (${this._languageId}): Failed to parse JSON from storage: ${err}.`);

			if (forShutdown) {
				// If we're shutting down, we can't do anything else, so just
				// return. No need to try to reset the whole storage state on
				// our way down.
				return;
			}

			// If we're not shutting down, we will recover (so we can store the
			// new state) by clearing the state and starting over with a fresh
			// input history.
			this._logService.warn(`LanguageInputHistory (${this._languageId}: Clearing to recover from error.`);
		}

		// Append the pending entries to the parsed entries.
		parsedEntries = parsedEntries.concat(this._pendingEntries);

		// Discard old entries from the front of the history if we've reached
		// the configured maximum.
		const max = this._configurationService.getValue<number>(inputHistorySizeSettingId);
		const overflow = parsedEntries.length - max;
		if (overflow > 0) {
			parsedEntries = parsedEntries.splice(overflow);
		}

		// Serialize the entries to JSON and write them to storage.
		const storageState = JSON.stringify(parsedEntries);
		this._logService.trace(`Saving input history in key ${this._storageKey} (${parsedEntries.length} items, ${storageState.length} bytes)`);

		// Write to machine/workspace specific storage so we can restore the
		// history in this "session"
		this._storageService.store(this._storageKey,
			storageState,
			StorageScope.PROFILE,
			StorageTarget.USER);

		// Clear the pending entries now that they've been flushed to storage.
		this._pendingEntries.splice(0, this._pendingEntries.length);
	}

	/**
	 * Clears the save timer if it's running.
	 */
	private clearSaveTimer(): void {
		if (this._timerId) {
			clearTimeout(this._timerId);
			this._timerId = undefined;
		}
	}

	public override dispose() {
		// If we are currently waiting for a debounced save to complete, make
		// sure we do it right away since we're about to be destroyed.
		if (this._timerId) {
			this.save(true);
		}
		super.dispose();
	}
}

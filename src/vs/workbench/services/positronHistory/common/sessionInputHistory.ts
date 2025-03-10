/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IExecutionHistoryEntry, IInputHistoryEntry, INPUT_HISTORY_STORAGE_PREFIX } from './executionHistoryService.js';
import { ILanguageRuntimeSession } from '../../runtimeSession/common/runtimeSessionService.js';

/**
 * Represents a history of inputs for a single language runtime session.
 * One instance of this class is created for each running session, so that each
 * runtime has its own input history.
 */
export class SessionInputHistory extends Disposable {
	/** An in-memory representation of all known entries. */
	private readonly _entries: IInputHistoryEntry[] = [];

	/** The unique key under which the entries are stored (by the storage service) */
	private readonly _storageKey: string;

	/** A timer used to debounce history writes. */
	private _timerId?: NodeJS.Timeout;

	/** A flag indicating whether there are entries that need to be flushed to storage */
	private _dirty: boolean = false;

	private readonly _sessionDisposables = this._register(new DisposableStore());

	constructor(
		private readonly _sessionId: string,
		private readonly _storageService: IStorageService,
		private readonly _logService: ILogService
	) {
		super();

		// Create storage key for this runtime based on its ID
		this._storageKey = `${INPUT_HISTORY_STORAGE_PREFIX}.${_sessionId}`;

		// Load existing history entries
		const entries = this._storageService.get(this._storageKey, StorageScope.WORKSPACE, '[]');
		try {
			JSON.parse(entries).forEach((entry: IExecutionHistoryEntry<any>) => {
				this._entries.push(entry);
			});
		} catch (err) {
			this._logService.warn(`Couldn't load input history for ${_sessionId}: ${err}}`);
		}

		// Ensure we persist the history on e.g. shutdown
		this._register(this._storageService.onWillSaveState(() => {
			this.save();
		}));
	}

	/**
	 * Attaches the session to this history instance.
	 *
	 * @param session The session to attach.
	 */
	attachSession(session: ILanguageRuntimeSession) {
		this._sessionDisposables.clear();
		this._sessionDisposables.add(session.onDidReceiveRuntimeMessageInput(message => {
			this._entries.push({
				when: Date.now(),
				input: message.code
			});
			this._dirty = true;
			this.delayedSave();
		}));
	}

	public override dispose() {
		if (this._timerId) {
			this.save();
		}
		super.dispose();
	}

	public getInputHistory(): IInputHistoryEntry[] {
		return this._entries;
	}

	/**
	 * Deletes the entire history. This is done when a session is permanently
	 * ended, or when the history is manually cleared.
	 */
	delete(): void {
		this._entries.length = 0;
		this._storageService.store(this._storageKey,
			null,
			StorageScope.WORKSPACE,
			StorageTarget.MACHINE);
	}

	/**
	 * Save the history entries to storage after a delay.
	 */
	private delayedSave(): void {
		// Reset any existing timer
		if (this._timerId) {
			clearTimeout(this._timerId);
			this._timerId = undefined;
		}

		// Set a new 5 second timer
		this._timerId = setTimeout(() => {
			this.save();
		}, 5000);
	}

	private save(): void {
		// Reset the timer if it's still running
		if (this._timerId) {
			clearTimeout(this._timerId);
			this._timerId = undefined;
		}

		// No need to save if we're not dirty
		if (!this._dirty) {
			return;
		}

		// Serialize the entries to JSON
		const storageState = JSON.stringify(this._entries);
		this._logService.trace(
			`Saving input history for session ${this._sessionId} ` +
			`(${storageState.length} bytes)`);

		// Write to machine/workspace specific storage so we can restore the
		// history in this "session"
		this._storageService.store(this._storageKey,
			storageState,
			StorageScope.WORKSPACE,
			StorageTarget.MACHINE);

		// Successfully saved; state is no longer dirty
		this._dirty = false;
	}
}

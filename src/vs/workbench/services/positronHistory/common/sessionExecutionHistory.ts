/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { EXECUTION_HISTORY_STORAGE_PREFIX, ExecutionEntryType, IExecutionHistoryEntry, IExecutionHistoryError } from './executionHistoryService.js';
import { ILanguageRuntimeInfo, ILanguageRuntimeMessage, ILanguageRuntimeMessageError, ILanguageRuntimeMessageOutput, ILanguageRuntimeMessageStream, RuntimeOnlineState } from '../../languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, RuntimeStartMode } from '../../runtimeSession/common/runtimeSessionService.js';

/**
 * Represents a history of executions for a single language runtime session.
 * One instance of this class is created for each running session, so that each
 * runtime has its own execution history.
 */
export class SessionExecutionHistory extends Disposable {
	/** An in-memory representation of all known entries. */
	private readonly _entries: IExecutionHistoryEntry<any>[] = [];

	/** The unique key under which the entries are stored (by the storage service) */
	private readonly _storageKey: string;

	/** A map of execution IDs to history entries for executions that have started but not completed. */
	private readonly _pendingExecutions: Map<string, IExecutionHistoryEntry<any>> = new Map();

	/** A timer used to debounce history writes. */
	private _timerId?: NodeJS.Timeout;

	/** A flag indicating whether there are entries that need to be flushed to storage */
	private _dirty: boolean = false;

	private readonly _sessionDisposables = this._register(new DisposableStore());

	constructor(
		private readonly _sessionId: string,
		private readonly _startMode: RuntimeStartMode,
		private readonly _storageService: IStorageService,
		private readonly _logService: ILogService
	) {
		super();

		// Create storage key for this runtime based on its ID
		this._storageKey = `${EXECUTION_HISTORY_STORAGE_PREFIX}.${_sessionId}`;

		// Load existing history entries
		const entries = this._storageService.get(this._storageKey, StorageScope.WORKSPACE, '[]');
		try {
			JSON.parse(entries).forEach((entry: IExecutionHistoryEntry<any>) => {
				this._entries.push(entry);
			});
		} catch (err) {
			this._logService.warn(`Couldn't load execution history for ${_sessionId}: ${err}}`);
		}

		// Ensure we persist the history on e.g. shutdown
		this._register(this._storageService.onWillSaveState(() => {
			// Flush any pending executions to the history entries
			this.flushPendingExecutions();

			// Save the history
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

		// When the sesion starts for the first time, listen for and record the
		// startup banner as a history entry.
		if (this._startMode === RuntimeStartMode.Starting) {
			this._sessionDisposables.add(session.onDidCompleteStartup(info => {
				// Add the startup banner as a history entry
				const entry: IExecutionHistoryEntry<ILanguageRuntimeInfo> = {
					id: `startup-${session.sessionId}`,
					when: Date.now(),
					prompt: '',
					input: '',
					outputType: ExecutionEntryType.Startup,
					output: info,
					durationMs: 0
				};
				this._entries.push(entry);
				this._dirty = true;
				this.delayedSave();
			}));
		}

		this._sessionDisposables.add(session.onDidReceiveRuntimeMessageInput(message => {
			// See if there is already a pending execution for the parent ID.
			// This is possible if an output message arrives before the input
			// message that caused it.
			const pending = this._pendingExecutions.get(message.parent_id);
			if (pending) {
				// If this is a duplicate input with different code, warn the user.
				if (pending.input) {
					this._logService.warn(
						`Received duplicate input messages for execution ${message.id}; ` +
						`replacing previous input '${pending.input}' with '${message.code}'.`);
				}

				// Set the input of the pending execution.
				pending.input = message.code;
			} else {
				// This is the first time we've seen this execution; create
				// a new entry.
				const entry: IExecutionHistoryEntry<string> = {
					id: message.parent_id,
					when: Date.parse(message.when),
					prompt: session.dynState.inputPrompt,
					input: message.code,
					outputType: ExecutionEntryType.Execution,
					output: '',
					durationMs: 0
				};

				// Add the entry to the pending executions map
				this._pendingExecutions.set(message.parent_id, entry);
			}
		}));

		const handleDidReceiveRuntimeMessageOutput = (message: ILanguageRuntimeMessageOutput) => {
			// Get the output.
			const output = message.data['text/plain'];
			if (output) {
				this.recordOutput(message, output);
			}
		};

		const handleDidReceiveRuntimeMessageStream = (message: ILanguageRuntimeMessageStream) => {
			// Get the output.
			const output = message.text;
			if (output) {
				this.recordOutput(message, output);
			}
		};

		const handleDidReceiveRuntimeMessageError = (message: ILanguageRuntimeMessageError) => {
			this.recordError(message);
		};

		this._sessionDisposables.add(
			session.onDidReceiveRuntimeMessageOutput(handleDidReceiveRuntimeMessageOutput));
		this._sessionDisposables.add(
			session.onDidReceiveRuntimeMessageResult(handleDidReceiveRuntimeMessageOutput));
		this._sessionDisposables.add(
			session.onDidReceiveRuntimeMessageStream(handleDidReceiveRuntimeMessageStream));
		this._sessionDisposables.add(
			session.onDidReceiveRuntimeMessageError(handleDidReceiveRuntimeMessageError));

		// When we receive a message indicating that an execution has completed,
		// we'll move it from the pending executions map to the history entries.
		this._sessionDisposables.add(session.onDidReceiveRuntimeMessageState(message => {
			if (message.state === RuntimeOnlineState.Idle) {
				const pending = this._pendingExecutions.get(message.parent_id);
				if (pending) {
					// Update the entry with the duration
					pending.durationMs = Date.now() - pending.when;

					// Remove from set of pending executions
					this._pendingExecutions.delete(message.parent_id);

					// Save the history after a delay
					this._entries.push(pending);
					this._dirty = true;
					this.delayedSave();
				}
			}
		}));

		// Flush any pending executions when the session ends
		this._sessionDisposables.add(session.onDidEndSession(() => {
			this.flushPendingExecutions();
		}));
	}

	/**
	 * Flush all pending executions to the history entries. This is done when
	 * the session ends or we're about to disconnect, so that any execution
	 * that never completed is still recorded.
	 */
	private flushPendingExecutions() {
		this._pendingExecutions.forEach(entry => {
			this._entries.push(entry);
			this._dirty = true;
		});
		this._pendingExecutions.clear();
	}

	private recordOutput(message: ILanguageRuntimeMessage, output: string) {
		// Get the pending execution and set its output.
		const pending = this._pendingExecutions.get(message.parent_id);
		if (pending) {
			pending.output += output;
		} else {
			// This is the first time we've seen this execution; create
			// a new entry.
			const entry: IExecutionHistoryEntry<string> = {
				id: message.parent_id,
				when: Date.parse(message.when),
				prompt: '',
				input: '',
				outputType: ExecutionEntryType.Execution,
				output,
				durationMs: 0
			};
			// Add the entry to the pending executions map
			this._pendingExecutions.set(message.parent_id, entry);
		}
	}

	private recordError(message: ILanguageRuntimeMessageError) {
		// Get the pending execution and set its output.
		const pending = this._pendingExecutions.get(message.parent_id);
		if (pending) {
			const error: IExecutionHistoryError = {
				name: message.name,
				message: message.message,
				traceback: message.traceback
			};
			pending.error = error;
		} else {
			// Currently, the history service intentionally does not record
			// errors that don't occur during an execution.
		}
	}

	public override dispose() {
		// If we are currently waiting for a debounced save to complete, make
		// sure we do it right away since we're about to be destroyed.
		if (this._timerId) {
			this.save();
		}
		super.dispose();
	}

	get entries(): IExecutionHistoryEntry<any>[] {
		return this._entries;
	}

	/**
	 * Clears the history. This is done when the console is cleared.
	 */
	clear(): void {
		// Delete all entries and save the new state
		this._entries.splice(0, this._entries.length);
		this.save();
	}

	/**
	 * Deletes the entire history. This is done when a session is permanently
	 * ended.
	 */
	delete(): void {
		this._storageService.store(this._storageKey,
			null,
			StorageScope.WORKSPACE,
			StorageTarget.MACHINE);
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

		// Set a new 10 second timer
		this._timerId = setTimeout(() => {
			this.save();
		}, 10000);
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
			`Saving execution history for session ${this._sessionId} ` +
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

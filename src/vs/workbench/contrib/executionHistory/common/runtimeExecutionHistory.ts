/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { ILogService } from 'vs/platform/log/common/log';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { IExecutionHistoryEntry } from 'vs/workbench/contrib/executionHistory/common/executionHistoryService';
import { ILanguageRuntime, RuntimeOnlineState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

/**
 * Represents a history of executions for a single language runtime. One
 * instance of this class is created for each running language runtime, so that
 * each runtime has its own execution history.
 */
export class RuntimeExecutionHistory extends Disposable {
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

	constructor(
		private readonly _runtime: ILanguageRuntime,
		private readonly _storageService: IStorageService,
		private readonly _logService: ILogService
	) {
		super();

		// Create storage key for this runtime based on its ID
		this._storageKey = `positron.executionHistory.${_runtime.metadata.id}`;

		// Load existing history entries
		const entries = this._storageService.get(this._storageKey, StorageScope.WORKSPACE, '[]');
		try {
			JSON.parse(entries).forEach((entry: IExecutionHistoryEntry<any>) => {
				this._entries.push(entry);
			});
		} catch (err) {
			this._logService.warn(`Couldn't load history for ${this._runtime.metadata.name} ${this._runtime.metadata.id}: ${err}}`);
		}

		this._register(this._runtime.onDidReceiveRuntimeMessageInput(message => {
			// It's possible for messages to be received out of order, so it's
			// possible -- if the code was executed very quickly -- that the
			// input will be received after we already know the output. In that
			// case, we'll just update the existing entry.
			if (this._pendingExecutions.has(message.id)) {
				// We should only get input for a message one time, but if for
				// some reason we get a second input, just warn and overwrite.
				const pending = this._pendingExecutions.get(message.id)!;
				if (pending.input) {
					this._logService.warn(`Received duplicate input for execution ${message.id}; replacing previous input ('${pending.input}' => '${message.code}')`);
				}
				this._pendingExecutions.get(message.id)!.input = message.code;
			} else {
				// Create a new entry
				const entry: IExecutionHistoryEntry<string> = {
					id: message.parent_id,
					when: Date.parse(message.when),
					input: message.code,
					outputType: '',
					output: '',
					durationMs: 0
				};

				// Add the entry to the pending executions map
				this._pendingExecutions.set(message.parent_id, entry);
			}
		}));

		this._register(this._runtime.onDidReceiveRuntimeMessageOutput(message => {
			// Currently, only plain text data is stored in the command history
			if (!Object.keys(message.data).includes('text/plain')) {
				return;
			}
			const outputText = (message.data as any)['text/plain'];

			if (this._pendingExecutions.has(message.id)) {
				const pending = this._pendingExecutions.get(message.id)!;
				if (pending) {
					// It's normal to receive several output events; if we do,
					// just concatenate the output.
					const output = pending.output || '';
					pending.output = output + outputText;
				} else {
					// This is the first time we've seen this execution; create
					// a new entry.
					const entry: IExecutionHistoryEntry<string> = {
						id: message.parent_id,
						when: Date.parse(message.when),
						input: '',
						outputType: 'text',
						output: outputText,
						durationMs: 0
					};

					// Add the entry to the pending executions map
					this._pendingExecutions.set(message.parent_id, entry);
				}
			}
		}));

		// When we receive a message indicating that an execution has completed,
		// we'll move it from the pending executions map to the history entries.
		this._register(this._runtime.onDidReceiveRuntimeMessageState(message => {
			if (message.state === RuntimeOnlineState.Idle) {
				if (this._pendingExecutions.has(message.parent_id)) {
					// Update the entry with the duration
					const entry = this._pendingExecutions.get(message.parent_id)!;
					entry.durationMs = Date.now() - entry.when;

					// Remove from set of pending executions
					this._pendingExecutions.delete(message.parent_id);

					// Save the history after a delay
					this._entries.push(entry);
					this._dirty = true;
					this.delayedSave();
				}
			}
		}));

		// Ensure we persist the history on e.g. shutdown
		this._register(this._storageService.onWillSaveState(() => {
			this.save();
		}));
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

	clear(): void {
		// Delete all entries and save the new state
		this._entries.splice(0, this._entries.length);
		this.save();
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

		// No need to save if we're not dirty
		if (!this._dirty) {
			return;
		}

		// Serialize the entries to JSON
		const storageState = JSON.stringify(this._entries);
		this._logService.trace(`Saving execution history in key ${this._storageKey} (${storageState.length} bytes)`);

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

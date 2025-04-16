/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from '../../../../base/common/uuid.js';
import { DeferredPromise } from '../../../../base/common/async.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ISettableObservable } from '../../../../base/common/observableInternal/base.js';
import { IRuntimeClientInstance, RuntimeClientState } from './languageRuntimeClientInstance.js';
import { ClipboardFormatFormat, PositronVariablesComm, RefreshEvent, ReturnAsyncClearEvent, UpdateEvent, Variable } from './positronVariablesComm.js';
import { RuntimeState } from '../../languageRuntime/common/languageRuntimeService.js';

/**
 * Represents a variable in a language runtime; wraps the raw data format with additional metadata
 * and methods.
 */
export class PositronVariable {
	/**
	 * Creates a new PositronVariable instance.
	 *
	 * @param data The raw data from the language runtime.
	 * @param parentKeys A list of the access keys of the parent variables, if any;
	 *   used to construct the full path to this variable.
	 * @param evaluated A flag indicating whether the variable was evaluated.
	 * @param _envClient The client instance that owns this variable.
	 */
	constructor(
		public readonly data: Variable,
		public readonly parentKeys: Array<string> = [],
		public readonly evaluated: boolean,
		private readonly _comm: PositronVariablesComm) {
	}

	/**
	 * Gets the path of this variable.
	 */
	get path() {
		return [...this.parentKeys, this.data.access_key];
	}

	/**
	 * Gets the ID of the comm client that owns the variable.
	 */
	get clientId() {
		return this._comm.clientId;
	}

	/**
	 * Gets the children of this variable, if any.
	 *
	 * @returns A promise that resolves to the list of children.
	 */
	async getChildren(): Promise<PositronVariablesList> {
		if (this.data.has_children) {
			const path = this.parentKeys.concat(this.data.access_key);
			const result = await this._comm.inspect(path);
			return new PositronVariablesList(result.children, path, this._comm);
		} else {
			throw new Error(`Attempt to retrieve children of ` +
				`${this.data.display_name} (${JSON.stringify(this.parentKeys)}) ` +
				`which has no children.`);
		}
	}

	/**
	 * Formats the value of this variable in a format suitable for placing on the clipboard.
	 *
	 * @param mime The desired MIME type of the format, such as 'text/plain' or 'text/html'.
	 * @returns A promise that resolves to the formatted value of this variable.
	 */
	async formatForClipboard(mime: ClipboardFormatFormat): Promise<string> {
		const path = this.parentKeys.concat(this.data.access_key);
		const result = await this._comm.clipboardFormat(path, mime);
		return result.content;
	}

	/**
	 * Requests that the language runtime open a viewer for this variable.
	 *
	 * @returns The ID of the viewer that was opened.
	 */
	async view(): Promise<string> {
		const path = this.parentKeys.concat(this.data.access_key);
		return this._comm.view(path);
	}
}

/**
 * A list of variables and their values; wraps the raw data format.
 */
export class PositronVariablesList {
	public readonly variables: Array<PositronVariable>;
	constructor(
		public readonly data: Array<Variable>,
		parentKeys: Array<string> = [],
		comm: PositronVariablesComm) {
		this.variables = data.map(v => new PositronVariable(v, parentKeys, true, comm));
	}
}

/**
 * Wraps the raw data format for an update message.
 */
export class PositronVariablesUpdate {
	/// The variables that have been added or changed
	public readonly assigned: Array<PositronVariable>;

	/// The names of the variables that have been removed
	public readonly removed: Array<string>;

	constructor(
		public readonly data: UpdateEvent,
		comm: PositronVariablesComm) {
		// Add all the assigned variables to the list of assignments
		this.assigned = data.assigned.map(v => new PositronVariable(v, [], true, comm));

		// Add all the unevaluated variables to the list of assignments, but
		// mark them as unevaluated
		this.assigned = this.assigned.concat(
			data.unevaluated.map(
				v => new PositronVariable(v, [], false, comm)));

		this.removed = data.removed;
	}
}

export enum VariablesClientStatus {
	Idle,
	Computing,
	Disconnected,
	Error
}

/**
 * The client-side interface to a variables (a set of named variables) inside
 * a language runtime.
 */
export class VariablesClientInstance extends Disposable {
	/// The client instance; used to send messages to (and receive messages from) the back end
	private _comm: PositronVariablesComm;

	private _onDidReceiveListEmitter = new Emitter<PositronVariablesList>();
	private _onDidReceiveUpdateEmitter = new Emitter<PositronVariablesUpdate>();

	onDidReceiveList = this._onDidReceiveListEmitter.event;
	onDidReceiveUpdate = this._onDidReceiveUpdateEmitter.event;

	/**
	 * The state of the client instance.
	 */
	public clientState: ISettableObservable<RuntimeClientState>;

	/**
	 * The current status of the client instance.
	 */
	public status: VariablesClientStatus = VariablesClientStatus.Idle;

	/**
	 * Promises for asynchronous tasks requested of the backend, keyed by callback ID.
	 */
	private readonly _asyncTasks = new Map<string, DeferredPromise<any>>();

	/**
	 * The number of pending tasks that are currently running.
	 */
	private _numPendingTasks = 0;

	/**
	 * The onDidStatusUpdate event emitter.
	 */
	private readonly _onDidChangeStatusEmitter = this._register(new Emitter<VariablesClientStatus>());

	/**
	 * Current state of the runtime (idle, busy, etc)
	 */
	public runtimeState: RuntimeState = RuntimeState.Offline;
	private readonly _onDidChangeRuntimeStateEmitter = this._register(new Emitter<RuntimeState>());

	/**
	 * Ceate a new variable client instance.
	 *
	 * @param client The client instance to use to communicate with the back end.
	 */
	constructor(client: IRuntimeClientInstance<any, any>) {
		super();

		this._comm = new PositronVariablesComm(client);
		this.clientState = client.clientState;

		// Connect the client instance to the back end
		this.connectClient(this._comm);

		// Register the onDidReturnAsyncClear event handler.
		this._register(this._comm.onDidReturnAsyncClear(async (e: ReturnAsyncClearEvent) => {
			if (this._asyncTasks.has(e.callback_id)) {
				const promise = this._asyncTasks.get(e.callback_id);
				if (e.error_message) {
					promise?.error(new Error(e.error_message));
				} else {
					promise?.complete(e);
				}
				this._asyncTasks.delete(e.callback_id);
			}
		}));
	}

	// Public methods --------------------------------------------------

	/**
	 * Requests that the variables client send a new list of variables.
	 */
	public async requestRefresh(): Promise<PositronVariablesList> {
		const list = await this._comm.list();
		return new PositronVariablesList(list.variables, [], this._comm);
	}

	/**
	 * Requests that the variables client clear all variables.
	 */
	public async requestClear(includeHiddenObjects: boolean): Promise<void> {
		return this._comm.clear(includeHiddenObjects);
	}

	/**
	 * Requests a asynchronous clear of all variables.
	 */
	public async requestAsyncClear(includeHiddenObjects: boolean): Promise<ReturnAsyncClearEvent> {
		const callbackId = generateUuid();
		const promise = new DeferredPromise<ReturnAsyncClearEvent>();
		this._asyncTasks.set(callbackId, promise);
		return this.runBackendTask(
			async () => {
				if (this.runtimeState !== RuntimeState.Idle) {
					// Wait until the runtime is ready to receive the request
					await new Promise<void>(resolve => {
						const disposable = this.onDidChangeRuntimeState(state => {
							if (state === RuntimeState.Idle) {
								disposable.dispose();
								resolve();
							}
						});
					});
				}
				await this._comm.asyncClear(callbackId, includeHiddenObjects);
				return promise.p;
			},
			() => ({ 'callback_id': callbackId, 'error_message': 'Client disconnected' })
		);
	}

	/**
	 * Requests that the variables client inspect the specified variable.
	 *
	 * @param path The path to the variable to inspect, as an array of access key values
	 * @returns The variable's children
	 */
	public async requestInspect(path: string[]): Promise<PositronVariablesList> {
		const list = await this._comm.inspect(path);
		return new PositronVariablesList(list.children, path, this._comm);
	}

	/**
	 * Requests that the variables client delete the specified variables.
	 *
	 * @param names The names of the variables to delete
	 * @returns A promise that resolves to an update message with the variables that were deleted
	 */
	public async requestDelete(names: Array<string>): Promise<PositronVariablesUpdate> {
		const removed = await this._comm.delete(names);
		return new PositronVariablesUpdate({
			assigned: [],
			unevaluated: [],
			removed,
			version: 0
		}, this._comm);
	}

	/**
	 * Requests that the variables client format the specified variable.
	 *
	 * @param format The format to request, as a MIME type, e.g. text/plain or text/html
	 * @param path The path to the variable to format
	 * @returns A promise that resolves to the formatted content
	 */
	public async requestClipboardFormat(format: ClipboardFormatFormat, path: string[]): Promise<string> {
		const formatted = await this._comm.clipboardFormat(path, format);
		return formatted.content;
	}

	/**
	 * Requests that the variables client open a viewer for the specified variable.
	 *
	 * @param path The path to the variable to view
	 */
	public async requestView(path: string[]) {
		await this._comm.view(path);
	}

	/**
	 * Set the runtime state
	 */
	public setRuntimeState(state: RuntimeState) {
		this.runtimeState = state;
		this._onDidChangeRuntimeStateEmitter.fire(state);
	}

	// Private methods -------------------------------------------------

	/**
	 * Connects this instance to its counterpart in the language runtime.
	 *
	 * @param client The client instance to connect
	 */
	private connectClient(client: PositronVariablesComm) {
		this._register(client);

		this._register(this._comm.onDidRefresh((e: RefreshEvent) => {
			this._onDidReceiveListEmitter.fire(new PositronVariablesList(
				e.variables,
				[], // No parent names; this is the top-level list
				this._comm));
		}));

		this._register(this._comm.onDidUpdate((e: UpdateEvent) => {
			this._onDidReceiveUpdateEmitter.fire(new PositronVariablesUpdate(
				e, this._comm));
		}));
	}

	private async runBackendTask<Type, F extends () => Promise<Type>,
		Alt extends () => Type>(task: F, disconnectedResult: Alt) {
		if (this.status === VariablesClientStatus.Disconnected) {
			return disconnectedResult();
		}
		this._numPendingTasks += 1;
		this.setStatus(VariablesClientStatus.Computing);
		try {
			return await task();
		} finally {
			this._numPendingTasks -= 1;
			if (this._numPendingTasks === 0) {
				this.setStatus(VariablesClientStatus.Idle);
			}
		}
	}

	private setStatus(status: VariablesClientStatus) {
		this.status = status;
		this._onDidChangeStatusEmitter.fire(status);
	}

	// Public events

	/**
	 * Event that fires when the status has been updated.
	 */
	public onDidChangeStatus = this._onDidChangeStatusEmitter.event;

	/**
	 * Event that fires when the runtime state changed.
	 */
	public onDidChangeRuntimeState = this._onDidChangeRuntimeStateEmitter.event;
}

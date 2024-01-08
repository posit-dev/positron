/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { IRuntimeClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeClientInstance';
import { ClipboardFormatFormat, PositronVariablesComm, RefreshEvent, UpdateEvent, Variable } from 'vs/workbench/services/languageRuntime/common/positronVariablesComm';

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
	 * @param _envClient The client instance that owns this variable.
	 */
	constructor(
		public readonly data: Variable,
		public readonly parentKeys: Array<string> = [],
		private readonly _comm: PositronVariablesComm) {
	}

	/**
	 * Gets the path of this variable.
	 */
	get path() {
		return [...this.parentKeys, this.data.access_key];
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
	 * @returns A promise that resolves when the request has been sent.
	 */
	async view(): Promise<void> {
		const path = this.parentKeys.concat(this.data.access_key);
		await this._comm.view(path);
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
		this.variables = data.map(v => new PositronVariable(v, parentKeys, comm));
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
		this.assigned = data.assigned.map(v => new PositronVariable(v, [], comm));
		this.removed = data.removed;
	}
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
	 * Ceate a new variable client instance.
	 *
	 * @param client The client instance to use to communicate with the back end.
	 */
	constructor(client: IRuntimeClientInstance<any, any>) {
		super();

		this._comm = new PositronVariablesComm(client);
		this.connectClient(this._comm);
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

	// Private methods -------------------------------------------------

	/**
	 * Connects this instance to its counterpart in the language runtime.
	 *
	 * @param client The client instance to connect
	 */
	private connectClient(client: PositronVariablesComm) {
		this._register(client);

		this._comm.onDidRefresh((e: RefreshEvent) => {
			this._onDidReceiveListEmitter.fire(new PositronVariablesList(
				e.variables,
				[], // No parent names; this is the top-level list
				this._comm));
		});

		this._comm.onDidUpdate((e: UpdateEvent) => {
			this._onDidReceiveUpdateEmitter.fire(new PositronVariablesUpdate(
				e, this._comm));
		});
	}
}

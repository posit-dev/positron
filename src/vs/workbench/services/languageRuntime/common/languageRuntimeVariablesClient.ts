/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { ILanguageRuntime } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IRuntimeClientInstance, RuntimeClientState, RuntimeClientType } from 'vs/workbench/services/languageRuntime/common/languageRuntimeClientInstance';

/**
 * The possible types of messages that can be sent to the language runtime as requests to the
 * variables backend.
 */
export enum VariablesClientMessageTypeInput {
	/** A request to send another List event */
	Refresh = 'refresh',

	/** A request to clear the runtime values */
	Clear = 'clear',

	/** A request to delete a specific set of named variables */
	Delete = 'delete',

	/** A request to inspect a specific variable */
	Inspect = 'inspect',

	/** A request to format the variable's content in a format suitable for the clipboard */
	ClipboardFormat = 'clipboard_format',

	/** A request to open a viewer for a specific variable */
	View = 'view',
}

/**
 * The possible types of responses or results that can be sent from the language runtime.
 */
export enum VariablesClientMessageTypeOutput {

	/** A full list of all the variables and their values */
	List = 'list',

	/**
	 * A partial update indicating the set of changes that have occurred since the last update or
	 * list event.
	 */
	Update = 'update',

	/** The details (children) of a specific variable */
	Details = 'details',

	/** The formatted content of a variable, suitable for placing on the clipboard */
	FormattedVariable = 'formatted_variable',

	/** A successful result of an RPC that doesn't otherwise return data. */
	Success = 'success',

	/** A processing error */
	Error = 'error',
}

/**
 * Represents the possible kinds of variable values.
 */
export enum VariableValueKind {
	/// A boolean value
	Boolean = 'boolean',

	/// A sequence of bytes or raw binary data
	Bytes = 'bytes',

	/// A iterable collection of unnamed values, such as a list or array
	Collection = 'collection',

	/// An empty, missing, null, or invalid value
	Empty = 'empty',

	/// A function, method, closure, or other callable object
	Function = 'function',

	/// A map, dictionary, named list, or associative array
	Map = 'map',

	/// A number, such as an integer or floating-point value
	Number = 'number',

	/// A value of an unknown or unspecified type
	Other = 'other',

	/// A character string
	String = 'string',

	/// A table, dataframe, 2D matrix, or other two-dimensional data structure
	Table = 'table',
}

/**
 * Represents a variable in a language runtime -- a value with a named identifier, not a system
 * environment variable.
 *
 * This is the raw data format used to communicate with the language runtime.
 */
export interface IVariable {
	/// A key that uniquely identifies the variable within the runtime and can be used to access the
	/// variable in `inspect` requests
	access_key: string;

	/// The name of the variable, formatted for display
	display_name: string;

	/// A string representation of the variable's value formatted for display, possibly truncated
	display_value: string;

	/// The variable's type, formatted for display
	display_type: string;

	/// Extended information about the variable's type
	type_info: string;

	/// The kind of value the variable represents, such as 'string' or 'number'
	kind: VariableValueKind;

	/// The number of elements in the variable's value, if applicable
	length: number;

	/// The size of the variable's value, in bytes
	size: number;

	/// True if the variable contains other variables
	has_children: boolean;

	/// True if there is a viewer available for the variable (i.e. the runtime
	/// can handle a 'view' message for the variable)
	has_viewer: boolean;

	/// True if the 'value' field was truncated to fit in the message
	is_truncated: boolean;
}

/**
 * Represents a variable in a language runtime; wraps the raw data format with additional metadata
 * and methods.
 */
export class Variable {
	/**
	 * Creates a new Variable instance.
	 *
	 * @param data The raw data from the language runtime.
	 * @param parentKeys A list of the access keys of the parent variables, if any;
	 *   used to construct the full path to this variable.
	 * @param _envClient The client instance that owns this variable.
	 */
	constructor(
		public readonly data: IVariable,
		public readonly parentKeys: Array<string> = [],
		private readonly _envClient: VariablesClientInstance) {
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
	async getChildren(): Promise<VariablesClientList> {
		if (this.data.has_children) {
			return this._envClient.requestInspect(this.parentKeys.concat(this.data.access_key));
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
	async formatForClipboard(mime: string): Promise<string> {
		return this._envClient.requestClipboardFormat(mime,
			this.parentKeys.concat(this.data.access_key));
	}

	/**
	 * Requests that the language runtime open a viewer for this variable.
	 *
	 * @returns A promise that resolves when the request has been sent.
	 */
	async view(): Promise<void> {
		await this._envClient.requestView(this.parentKeys.concat(this.data.access_key));
	}
}

/**
 * A message used to send data to the language runtime variables client.
 */
export interface IVariablesClientMessageInput {
	msg_type: VariablesClientMessageTypeInput;
}

/**
 * A request to inspect a specific variable, given a path of names.
 */
export interface IVariablesClientMessageInspect extends IVariablesClientMessageInput {
	path: string[];
}

/**
 * A request to view a specific variable, given a path of names.
 */
export interface IVariablesClientMessageView extends IVariablesClientMessageInput {
	path: string[];
}

/**
 * A request to get the formatted content of a variable, suitable for placing on the clipboard.
 */
export interface IVariablesClientMessageClipboardFormat extends IVariablesClientMessageInput {
	path: string[];
}

/**
 * A request to delete a specific set of named variables.
 */
export interface IVariablesClientMessageDelete extends IVariablesClientMessageInput {
	names: Array<string>;
}

/**
 * A request to clear all variables
 */
export interface IVariablesClientMessageClear extends IVariablesClientMessageInput {
	include_hidden_objects: boolean;
}

/**
 * A message used to receive data from the language runtime variables client.
 */
export interface IVariablesClientMessageOutput {
	msg_type: VariablesClientMessageTypeOutput;
}

/**
 * A list of all the variables and their values.
 */
export interface IVariablesClientMessageList extends IVariablesClientMessageOutput {
	/// The list of variables
	variables: Array<IVariable>;

	/// The total number of variables known to the runtime. This may be greater
	/// than the number of variables in the list if the list was truncated.
	length: number;
}

/**
 * The details (children) of a specific variable.
 */
export interface IVariablesClientMessageDetails extends IVariablesClientMessageOutput {
	/// The list of child variables
	children: Array<IVariable>;

	/// The total number of child variables. This may be greater than the number
	/// of variables in the list if the list was truncated.
	length: number;
}

/**
 * The details (children) of a specific variable.
 */
export interface IVariablesClientMessageFormattedVariable extends IVariablesClientMessageOutput {
	format: string;
	content: string;
}

/**
 * A list of variables and their values; wraps the raw data format.
 */
export class VariablesClientList {
	public readonly variables: Array<Variable>;
	constructor(
		public readonly data: Array<IVariable>,
		parentKeys: Array<string> = [],
		envClient: VariablesClientInstance) {
		this.variables = data.map(v => new Variable(v, parentKeys, envClient));
	}
}

/**
 * A partial update indicating the set of changes that have occurred since the
 * last update or list event.
 */
export interface IVariablesClientMessageUpdate extends IVariablesClientMessageOutput {
	assigned: Array<IVariable>;
	removed: Array<string>;
}


/**
 * Wraps the raw data format for an update message.
 */
export class VariablesClientUpdate {
	/// The variables that have been added or changed
	public readonly assigned: Array<Variable>;

	/// The names of the variables that have been removed
	public readonly removed: Array<string>;

	constructor(
		public readonly data: IVariablesClientMessageUpdate,
		envClient: VariablesClientInstance) {
		this.assigned = data.assigned.map(v => new Variable(v, [], envClient));
		this.removed = data.removed;
	}
}

/**
 * A processing error that occurred in the language runtime or backend of the variables client.
 */
export interface IVariablesClientMessageError extends IVariablesClientMessageOutput {
	message: string;
}

/**
 * A type that represents a variables client instance; it sends messages of type
 * IVariablesClientMessageInput and receives messages of type IVariablesClientMessageOutput.
 */
export type IVariablesClientInstance =
	IRuntimeClientInstance<
		IVariablesClientMessageInput,
		IVariablesClientMessageOutput>;

/**
 * The client-side interface to a variables (a set of named variables) inside
 * a language runtime.
 */
export class VariablesClientInstance extends Disposable {
	/// The client instance; used to send messages to (and receive messages from) the back end
	private _client?: IVariablesClientInstance;

	private _onDidReceiveListEmitter = new Emitter<VariablesClientList>();
	private _onDidReceiveUpdateEmitter = new Emitter<VariablesClientUpdate>();
	private _onDidReceiveErrorEmitter = new Emitter<IVariablesClientMessageError>();

	onDidReceiveList = this._onDidReceiveListEmitter.event;
	onDidReceiveUpdate = this._onDidReceiveUpdateEmitter.event;
	onDidReceiveError = this._onDidReceiveErrorEmitter.event;

	/**
	 * Ceate a new variable client instance.
	 *
	 * @param _runtime The language runtime that will host the variables client
	 */
	constructor(private readonly _runtime: ILanguageRuntime) {
		super();

		this._runtime.createClient<IVariablesClientMessageInput, IVariablesClientMessageOutput>(
			RuntimeClientType.Variables, {}).then(client => {
				this.connectClient(client as IVariablesClientInstance);
			});
	}

	// Public methods --------------------------------------------------

	/**
	 * Requests that the variables client send a new list of variables.
	 */
	public async requestRefresh(): Promise<VariablesClientList> {
		const list = await this.performRpc<IVariablesClientMessageList>('refresh',
			{ msg_type: VariablesClientMessageTypeInput.Refresh });
		return new VariablesClientList(list.variables, [], this);
	}

	/**
	 * Requests that the variables client clear all variables.
	 */
	public async requestClear(includeHiddenObjects: boolean): Promise<VariablesClientList> {
		const list = await this.performRpc<IVariablesClientMessageList>('clear all variables',
			{
				msg_type: VariablesClientMessageTypeInput.Clear,
				include_hidden_objects: includeHiddenObjects
			} as IVariablesClientMessageClear);
		return new VariablesClientList(list.variables, [], this);
	}

	/**
	 * Requests that the variables client inspect the specified variable.
	 *
	 * @param path The path to the variable to inspect, as an array of access key values
	 * @returns The variable's children
	 */
	public async requestInspect(path: string[]): Promise<VariablesClientList> {
		const list = await this.performRpc<IVariablesClientMessageDetails>('inspect',
			{
				msg_type: VariablesClientMessageTypeInput.Inspect,
				path
			} as IVariablesClientMessageInspect);
		return new VariablesClientList(list.children, path, this);
	}

	/**
	 * Requests that the variables client delete the specified variables.
	 *
	 * @param names The names of the variables to delete
	 * @returns A promise that resolves to an update message with the variables that were deleted
	 */
	public async requestDelete(names: Array<string>): Promise<VariablesClientUpdate> {
		const update = await this.performRpc<IVariablesClientMessageUpdate>(
			'delete named variables',
			{
				msg_type: VariablesClientMessageTypeInput.Delete,
				names
			} as IVariablesClientMessageDelete);
		return new VariablesClientUpdate(update, this);
	}

	/**
	 * Requests that the variables client format the specified variable.
	 *
	 * @param format The format to request, as a MIME type, e.g. text/plain or text/html
	 * @param path The path to the variable to format
	 * @returns A promise that resolves to the formatted content
	 */
	public async requestClipboardFormat(format: string, path: string[]): Promise<string> {
		const formatted = await this.performRpc<IVariablesClientMessageFormattedVariable>(
			'get clipboard format',
			{
				msg_type: VariablesClientMessageTypeInput.ClipboardFormat,
				format,
				path
			} as IVariablesClientMessageClipboardFormat);
		return formatted.content;
	}

	/**
	 * Requests that the variables client open a viewer for the specified variable.
	 *
	 * @param path The path to the variable to view
	 */
	public async requestView(path: string[]) {
		return this.performRpc<IVariablesClientMessageView>(
			'view',
			{
				msg_type: VariablesClientMessageTypeInput.View,
				path
			} as IVariablesClientMessageView);
	}

	// Private methods -------------------------------------------------

	/**
	 * Connects this instance to its counterpart in the language runtime.
	 *
	 * @param client The client instance to connect
	 */
	private connectClient(client: IVariablesClientInstance) {
		this._client = client;
		this._register(client);
		this._client.onDidReceiveData(this.onDidReceiveData, this);
	}

	/**
	 * Converts the data received from the back end into a strongly-typed message.
	 *
	 * @param msg The message received from the back end
	 */
	private onDidReceiveData(msg: IVariablesClientMessageOutput) {
		switch (msg.msg_type) {
			case VariablesClientMessageTypeOutput.List:
				this._onDidReceiveListEmitter.fire(new VariablesClientList(
					(msg as IVariablesClientMessageList).variables,
					[], // No parent names; this is the top-level list
					this));
				break;

			case VariablesClientMessageTypeOutput.Update:
				this._onDidReceiveUpdateEmitter.fire(new VariablesClientUpdate(
					msg as IVariablesClientMessageUpdate, this));
				break;

			case VariablesClientMessageTypeOutput.Error:
				this._onDidReceiveErrorEmitter.fire(msg as IVariablesClientMessageError);
				break;

			default:
				console.error(`Unknown variables client message type '${msg.msg_type}', ` +
					`ignorning message: ${JSON.stringify(msg)}`);
		}
	}

	/**
	 * Performs an RPC operation on the variables client.
	 *
	 * @param op A debug-friendly name for the operation being performed
	 * @param msg The message to deliver to the back end
	 * @returns A promise that resolves to the message received from the back end
	 */
	private async performRpc<T>(op: string,
		msg: IVariablesClientMessageInput): Promise<T> {
		// Return a promise that performs the RPC and then resolves to the return type
		return new Promise((resolve, reject) => {

			if (!this._client) {
				reject(new Error(`Cannot perform '${op}' on variables client: ` +
					`no client is present`));
				return;
			}

			// Don't perform this request if the client isn't active. Consider: If
			// the client is still in a starting state (such as 'opening'), we *could*
			// queue up the request and send it when the client is ready.
			const clientState = this._client.getClientState();
			if (clientState !== RuntimeClientState.Connected) {
				throw new Error(`Cannot perform '${op}' on variables client: ` +
					`client instance is '${clientState}'`);
			}

			// Perform the RPC and resolve/reject the promise based on the result
			this._client.performRpc(msg).then(msg => {
				// If the message is an error, reject the promise; otherwise, resolve it
				if (msg.msg_type === VariablesClientMessageTypeOutput.Error) {
					const err = msg as IVariablesClientMessageError;
					reject(err.message);
				} else {
					resolve(msg as T);
				}
			}).catch(err => {
				// If the RPC fails, reject the promise
				reject(err);
			});
		});
	}
}

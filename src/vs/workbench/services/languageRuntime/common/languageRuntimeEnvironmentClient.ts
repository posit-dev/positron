/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { IRuntimeClientInstance, RuntimeClientState, RuntimeClientType } from 'vs/workbench/services/languageRuntime/common/languageRuntimeClientInstance';
import { ILanguageRuntime } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';


/**
 * The possible types of messages that can be sent to the language runtime as
 * requests to the environment backend.
 */
export enum EnvironmentClientMessageTypeInput {
	/** A request to send another List event */
	Refresh = 'refresh',

	/** A request to clear the environment */
	Clear = 'clear',

	/** A request to delete a specific set of named variables */
	Delete = 'delete',
}

/**
 * The possible types of responses or results that can be sent from the language
 * runtime
 */
export enum EnvironmentClientMessageTypeOutput {

	/** A full list of all the variables and their values */
	List = 'list',

	/**
	 * A partial update indicating the set of changes that have occurred since
	 * the last update or list event.
	 */
	Update = 'update',

	/** A successful result of an RPC that doesn't otherwise return data. */
	Success = 'success',

	/** A processing error */
	Error = 'error',
}

/**
 * Represents the possible kinds of values in an environment.
 */
export enum EnvironmentVariableValueKind {
	String = 'string',
	Number = 'number',
	Vector = 'vector',
	List = 'list',
	Function = 'function',
	Dataframe = 'dataframe',
}

/**
 * Represents a variable in a language runtime environment -- a value with a
 * named identifier, not a system environment variable.
 */
export interface IEnvironmentVariable {
	/// The name of the variable
	name: string;

	/// A string representation of the variable's value, possibly truncated
	value: string;

	/// The kind of value the variable represents, such as 'string' or 'number'
	kind: EnvironmentVariableValueKind;

	/// The number of elements in the variable's value, if applicable
	length: number;

	/// The size of the variable's value, in bytes
	size: number;

	/// True if the 'value' field was truncated to fit in the message
	truncated: boolean;
}

/**
 * A message used to send data to the language runtime environment client.
 */
export interface IEnvironmentClientMessageInput {
	msg_type: EnvironmentClientMessageTypeInput;
}

export interface IEnvironmentClientMessageDelete extends IEnvironmentClientMessageInput {
	names: Array<string>;
}

/**
 * A message used to receive data from the language runtime environment client.
 */
export interface IEnvironmentClientMessageOutput {
	msg_type: EnvironmentClientMessageTypeOutput;
}

export interface IEnvironmentClientMessageList extends IEnvironmentClientMessageOutput {
	variables: Array<IEnvironmentVariable>;
}

export interface IEnvironmentClientMessageUpdate extends IEnvironmentClientMessageOutput {
	assigned: Array<IEnvironmentVariable>;
	removed: Array<string>;
}

export interface IEnvironmentClientMessageError extends IEnvironmentClientMessageOutput {
	message: string;
}

/**
 * A type that represents an environment client instance; it sends messages of
 * type IEnvironmentClientMessageInput and receives messages of type
 * IEnvironmentClientMessageOutput.
 */
export type IEnvironmentClientInstance =
	IRuntimeClientInstance<
		IEnvironmentClientMessageInput,
		IEnvironmentClientMessageOutput>;

/**
 * The client-side interface to an environment (a set of named variables) inside
 * a language runtime.
 */
export class EnvironmentClientInstance extends Disposable {
	/// The client instance; used to send messages to (and receive messages from) the back end
	private _client?: IEnvironmentClientInstance;

	private _onDidReceiveListEmitter = new Emitter<IEnvironmentClientMessageList>();
	private _onDidReceiveUpdateEmitter = new Emitter<IEnvironmentClientMessageUpdate>();
	private _onDidReceiveErrorEmitter = new Emitter<IEnvironmentClientMessageError>();

	onDidReceiveList = this._onDidReceiveListEmitter.event;
	onDidReceiveUpdate = this._onDidReceiveUpdateEmitter.event;
	onDidReceiveError = this._onDidReceiveErrorEmitter.event;

	/**
	 * Ceate a new environment client instance.
	 *
	 * @param _runtime The language runtime that will host the environment client
	 */
	constructor(private readonly _runtime: ILanguageRuntime) {
		super();

		this._runtime.createClient<IEnvironmentClientMessageInput, IEnvironmentClientMessageOutput>(
			RuntimeClientType.Environment, {}).then(client => {
				this.connectClient(client as IEnvironmentClientInstance);
			});
	}

	// Public methods --------------------------------------------------

	/**
	 * Requests that the environment client send a new list of variables.
	 */
	public async requestRefresh(): Promise<IEnvironmentClientMessageList> {
		return this.performRpc<IEnvironmentClientMessageList>('refresh',
			{ msg_type: EnvironmentClientMessageTypeInput.Refresh });
	}
	/**
	 * Requests that the environment client clear all variables.
	 */
	public async requestClear(): Promise<void> {
		return this.performRpc<void>('clear all variables',
			{ msg_type: EnvironmentClientMessageTypeInput.Clear });
	}

	/**
	 * Requests that the environment client delete the specified variables.
	 *
	 * @param names The names of the variables to delete
	 * @returns A promise that resolves to an update message with the variables that were deleted
	 */
	public async requestDelete(names: Array<string>): Promise<IEnvironmentClientMessageUpdate> {
		return this.performRpc<IEnvironmentClientMessageUpdate>(
			'delete named variables',
			{
				msg_type: EnvironmentClientMessageTypeInput.Delete,
				names
			} as IEnvironmentClientMessageDelete);
	}

	// Private methods -------------------------------------------------

	/**
	 * Connects this instance to its counterpart in the language runtime.
	 *
	 * @param client The client instance to connect
	 */
	private connectClient(client: IEnvironmentClientInstance) {
		this._client = client;
		this._register(client);
		this._client.onDidReceiveData(this.onDidReceiveData, this);
	}

	/**
	 * Converts the data received from the back end into a strongly-typed message.
	 *
	 * @param msg The message received from the back end
	 */
	private onDidReceiveData(msg: IEnvironmentClientMessageOutput) {
		switch (msg.msg_type) {
			case EnvironmentClientMessageTypeOutput.List:
				this._onDidReceiveListEmitter.fire(msg as IEnvironmentClientMessageList);
				break;

			case EnvironmentClientMessageTypeOutput.Update:
				this._onDidReceiveUpdateEmitter.fire(msg as IEnvironmentClientMessageUpdate);
				break;

			case EnvironmentClientMessageTypeOutput.Error:
				this._onDidReceiveErrorEmitter.fire(msg as IEnvironmentClientMessageError);
				break;

			default:
				console.error(`Unknown environment client message type '${msg.msg_type}', ` +
					`ignorning message: ${JSON.stringify(msg)}`);
		}
	}

	/**
	 * Performs an RPC operation on the environment client.
	 *
	 * @param op A debug-friendly name for the operation being performed
	 * @param msg The message to deliver to the back end
	 * @returns A promise that resolves to the message received from the back end
	 */
	private async performRpc<T>(op: string,
		msg: IEnvironmentClientMessageInput): Promise<T> {
		// Return a promise that performs the RPC and then resolves to the return type
		return new Promise((resolve, reject) => {

			if (!this._client) {
				reject(new Error(`Cannot perform '${op}' on environment client: ` +
					`no client is present`));
				return;
			}

			// Don't perform this request if the client isn't active. Consider: If
			// the client is still in a starting state (such as 'opening'), we *could*
			// queue up the request and send it when the client is ready.
			const clientState = this._client.getClientState();
			if (clientState !== RuntimeClientState.Connected) {
				throw new Error(`Cannot perform '${op}' on environment client: ` +
					`client instance is '${clientState}'`);
			}

			// Perform the RPC and resolve/reject the promise based on the result
			this._client.performRpc(msg).then(msg => {
				// If the message is an error, reject the promise; otherwise, resolve it
				if (msg.msg_type === EnvironmentClientMessageTypeOutput.Error) {
					const err = msg as IEnvironmentClientMessageError;
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

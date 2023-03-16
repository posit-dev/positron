/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { IRuntimeClientInstance, RuntimeClientState, RuntimeClientType } from 'vs/workbench/services/languageRuntime/common/languageRuntimeClientInstance';
import { ILanguageRuntime } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';


export enum EnvironmentClientMessageType {
	/// Requests: Client -> Server --------------------------------------

	/** A request to send another List event */
	Refresh = 'refresh',

	/** A request to clear the environment */
	Clear = 'clear',

	/** A request to delete a specific set of named variables */
	Delete = 'delete',

	/// Responses/Events: Server -> Client ------------------------------

	/** A full list of all the variables and their values */
	List = 'list',

	/**
	 * A partial update indicating the set of changes that have occurred since
	 * the last update or list event.
	 */
	Update = 'update',

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
 * A message used to communicate with the language runtime environment client.
 */
export interface IEnvironmentClientMessage {
	msg_type: EnvironmentClientMessageType;
}

export interface IEnvironmentClientMessageList extends IEnvironmentClientMessage {
	variables: Array<IEnvironmentVariable>;
}

export interface IEnvironmentClientMessageUpdate extends IEnvironmentClientMessage {
	assigned: Array<IEnvironmentVariable>;
	removed: Array<string>;
}

export interface IEnvironmentClientMessageDelete extends IEnvironmentClientMessage {
	names: Array<string>;
}

export interface IEnvironmentClientMessageError extends IEnvironmentClientMessage {
	message: string;
}

export type IEnvironmentClientInstance = IRuntimeClientInstance<IEnvironmentClientMessage>;

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

		this._runtime.createClient<IEnvironmentClientMessage>(
			RuntimeClientType.Environment, {}).then(client => {
				this.connectClient(client as IEnvironmentClientInstance);
			});
	}

	// Public methods --------------------------------------------------

	/**
	 * Requests that the environment client send a new list of variables.
	 */
	public requestRefresh() {
		this.withActiveClient('refresh', client => {
			client.sendMessage({ msg_type: EnvironmentClientMessageType.Refresh });
		});
	}

	/**
	 * Requests that the environment client clear all variables.
	 */
	public requestClear() {
		this.withActiveClient('clear', client => {
			client.sendMessage({ msg_type: EnvironmentClientMessageType.Clear });
		});
	}

	/**
	 * Requests that the environment client delete the specified variables.
	 *
	 * @param names The names of the variables to delete
	 */
	public requestDelete(names: Array<string>) {
		this.withActiveClient('delete', client => {
			client.sendMessage(
				{
					msg_type: EnvironmentClientMessageType.Delete,
					names
				} as IEnvironmentClientMessageDelete);
		});
	}

	// Private methods -------------------------------------------------

	private withActiveClient<T>(op: string, callback: (client: IEnvironmentClientInstance) => T): T | undefined {
		if (!this._client) {
			throw new Error(`Cannot perform '${op}' on environment client: no client is present`);
		}

		// Don't perform this request if the client isn't active. Consider: If
		// the client is still in a starting state (such as 'opening'), we *could*
		// queue up the request and send it when the client is ready.
		const clientState = this._client.getClientState();
		if (clientState !== RuntimeClientState.Connected) {
			throw new Error(`Cannot perform '${op}' on environment client: ` +
				`client instance is '${clientState}'`);
		}

		return callback(this._client);
	}

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
	private onDidReceiveData(msg: IEnvironmentClientMessage) {
		switch (msg.msg_type) {
			case EnvironmentClientMessageType.List:
				this._onDidReceiveListEmitter.fire(msg as IEnvironmentClientMessageList);
				break;

			case EnvironmentClientMessageType.Update:
				this._onDidReceiveUpdateEmitter.fire(msg as IEnvironmentClientMessageUpdate);
				break;

			case EnvironmentClientMessageType.Error:
				this._onDidReceiveErrorEmitter.fire(msg as IEnvironmentClientMessageError);
				break;

			default:
				console.error(`Unknown environment client message type '${msg.msg_type}', ` +
					`ignorning message: ${JSON.stringify(msg)}`);
		}
	}
}

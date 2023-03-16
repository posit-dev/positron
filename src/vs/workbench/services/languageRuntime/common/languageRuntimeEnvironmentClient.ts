/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { IRuntimeClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeClientInstance';


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

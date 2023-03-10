/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { IRuntimeClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeClientInstance';


export enum EnvironmentClientMessageType {
	/** A full list of all the variables and their values */
	List = 'list',

	/** A request to send another List event */
	Refresh = 'refresh',

	/** A processing error */
	Error = 'error',

	// TODO: Add message types for other actions, such as adding a single
	// variable or updating a variable's value.
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
	name: string;
	kind: EnvironmentVariableValueKind;
	value: string;
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

export interface IEnvironmentClientMessageError extends IEnvironmentClientMessage {
	message: string;
}

export type IEnvironmentClientInstance = IRuntimeClientInstance<IEnvironmentClientMessage>;

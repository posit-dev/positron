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

export interface IEnvironmentClientMessage {
	type: EnvironmentClientMessageType;
}

export interface IEnvironmentClientMessageList {
	type: EnvironmentClientMessageType.List;
	variables: Array<string>;
}

export interface IEnvironmentClientMessageError {
	type: EnvironmentClientMessageType.Error;
	message: string;
}

export type IEnvironmentClientInstance = IRuntimeClientInstance<IEnvironmentClientMessage>;

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { Event } from 'vs/base/common/event';
import { IRuntimeClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeClientInstance';
import { BusyEvent, FrontendEvent, PositronFrontendComm, PromptStateEvent, ShowMessageEvent, WorkingDirectoryEvent } from './positronFrontendComm';


/**
 * The types of messages that can be sent to the backend.
 */
export enum FrontEndMessageTypeInput {
}

/**
 * A message used to send data to the backend.
 */
export interface IFrontEndClientMessageInput {
	msg_type: FrontEndMessageTypeInput;
}

/**
 * The types of messages that can be received from the backend.
 */
export enum FrontEndMessageTypeOutput {
	Event = 'event',
}

/**
 * A message used to deliver data from the backend to the frontend
 */
export interface IFrontEndClientMessageOutput {
	msg_type: FrontEndMessageTypeOutput;
}

/**
 * An event from the backend.
 */
export interface IRuntimeClientEvent {
	name: FrontendEvent;
	data: any;
}

/**
 * A message representing an event from the backend
 */
export interface IFrontEndClientMessageOutputEvent
	extends IFrontEndClientMessageOutput, IRuntimeClientEvent {
}

/**
 * A frontend client instance. This client instance represents the global Positron window, and
 * its lifetime is tied to the lifetime of the Positron window.
 *
 * It is currently used to deliver global events from the backend to the frontend, and to help
 * the backend know when Positron is connected.
 */
export class FrontEndClientInstance extends Disposable {
	private _comm: PositronFrontendComm;

	/** Emitters for events forwarded from the frontend comm */
	onDidBusy: Event<BusyEvent>;
	onDidShowMessage: Event<ShowMessageEvent>;
	onDidPromptState: Event<PromptStateEvent>;
	onDidWorkingDirectory: Event<WorkingDirectoryEvent>;

	/**
	 * Creates a new frontend client instance.
	 *
	 * @param _client The client instance. Takes ownership of the client
	 *   instance and will dispose it when it is disposed.
	 */
	constructor(
		private readonly _client: IRuntimeClientInstance<any, any>,
	) {
		super();
		this._register(this._client);

		this._comm = new PositronFrontendComm(this._client);
		this.onDidBusy = this._comm.onDidBusy;
		this.onDidShowMessage = this._comm.onDidShowMessage;
		this.onDidPromptState = this._comm.onDidPromptState;
		this.onDidWorkingDirectory = this._comm.onDidWorkingDirectory;
	}
}

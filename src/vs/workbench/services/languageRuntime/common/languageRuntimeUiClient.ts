/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { Event } from 'vs/base/common/event';
import { IRuntimeClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeClientInstance';
import { BusyEvent, ClearConsoleEvent, UiFrontendEvent, OpenEditorEvent, PositronUiComm, PromptStateEvent, ShowMessageEvent, WorkingDirectoryEvent } from './positronUiComm';


/**
 * The types of messages that can be sent to the backend.
 */
export enum UiMessageTypeInput {
}

/**
 * A message used to send data to the backend.
 */
export interface IUiClientMessageInput {
	msg_type: UiMessageTypeInput;
}

/**
 * The types of messages that can be received from the backend.
 */
export enum UiMessageTypeOutput {
	Event = 'event',
}

/**
 * A message used to deliver data from the backend to the frontend
 */
export interface IUiClientMessageOutput {
	msg_type: UiMessageTypeOutput;
}

/**
 * An event from the backend.
 */
export interface IRuntimeClientEvent {
	name: UiFrontendEvent;
	data: any;
}

/**
 * A message representing an event from the backend
 */
export interface IUiClientMessageOutputEvent
	extends IUiClientMessageOutput, IRuntimeClientEvent {
}

/**
 * A UI client instance. This client instance represents the global Positron window, and
 * its lifetime is tied to the lifetime of the Positron window.
 *
 * It is currently used to deliver global events from the backend to the frontend, and to help
 * the backend know when Positron is connected.
 */
export class UiClientInstance extends Disposable {
	private _comm: PositronUiComm;

	/** Emitters for events forwarded from the UI comm */
	onDidBusy: Event<BusyEvent>;
	onDidClearConsole: Event<ClearConsoleEvent>;
	onDidOpenEditor: Event<OpenEditorEvent>;
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

		this._comm = new PositronUiComm(this._client);
		this.onDidBusy = this._comm.onDidBusy;
		this.onDidClearConsole = this._comm.onDidClearConsole;
		this.onDidOpenEditor = this._comm.onDidOpenEditor;
		this.onDidShowMessage = this._comm.onDidShowMessage;
		this.onDidPromptState = this._comm.onDidPromptState;
		this.onDidWorkingDirectory = this._comm.onDidWorkingDirectory;
	}
}

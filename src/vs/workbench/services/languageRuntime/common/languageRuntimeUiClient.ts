/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { IRuntimeClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeClientInstance';
import { BusyEvent, ClearConsoleEvent, UiFrontendEvent, OpenEditorEvent, OpenWorkspaceEvent, PromptStateEvent, ShowMessageEvent, WorkingDirectoryEvent, ExecuteCommandEvent, ShowUrlEvent, SetEditorSelectionsEvent } from './positronUiComm';
import { PositronUiCommInstance } from 'vs/workbench/services/languageRuntime/common/positronUiCommInstance';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { URI } from 'vs/base/common/uri';


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
	private _comm: PositronUiCommInstance;

	/** Emitters for events forwarded from the UI comm */
	onDidBusy: Event<BusyEvent>;
	onDidClearConsole: Event<ClearConsoleEvent>;
	onDidSetEditorSelections: Event<SetEditorSelectionsEvent>;
	onDidOpenEditor: Event<OpenEditorEvent>;
	onDidOpenWorkspace: Event<OpenWorkspaceEvent>;
	onDidShowMessage: Event<ShowMessageEvent>;
	onDidPromptState: Event<PromptStateEvent>;
	onDidWorkingDirectory: Event<WorkingDirectoryEvent>;
	onDidExecuteCommand: Event<ExecuteCommandEvent>;
	onDidShowUrl: Event<ShowUrlEvent>;

	/** Emitter wrapper for Show URL events */
	private _onDidShowUrlEmitter = this._register(new Emitter<ShowUrlEvent>());

	/**
	 * Creates a new frontend client instance.
	 *
	 * @param _client The client instance. Takes ownership of the client
	 *   instance and will dispose it when it is disposed.
	 */
	constructor(
		private readonly _client: IRuntimeClientInstance<any, any>,
		private readonly openerService: IOpenerService,
	) {
		super();
		this._register(this._client);

		this._comm = new PositronUiCommInstance(this._client);
		this.onDidBusy = this._comm.onDidBusy;
		this.onDidClearConsole = this._comm.onDidClearConsole;
		this.onDidSetEditorSelections = this._comm.onDidSetEditorSelections;
		this.onDidOpenEditor = this._comm.onDidOpenEditor;
		this.onDidOpenWorkspace = this._comm.onDidOpenWorkspace;
		this.onDidShowMessage = this._comm.onDidShowMessage;
		this.onDidPromptState = this._comm.onDidPromptState;
		this.onDidWorkingDirectory = this._comm.onDidWorkingDirectory;
		this.onDidExecuteCommand = this._comm.onDidExecuteCommand;
		this.onDidShowUrl = this._onDidShowUrlEmitter.event;

		// Wrap the ShowUrl event to resolve incoming external URIs from the
		// backend before broadcasting them to the frontend.
		this._register(this._comm.onDidShowUrl(async e => {
			try {
				const uri = URI.parse(e.url);
				const resolvedUri = await this.openerService.resolveExternalUri(uri);
				const resolvedEvent: ShowUrlEvent = {
					url: resolvedUri.resolved.toString(),
				};
				this._onDidShowUrlEmitter.fire(resolvedEvent);
			} catch {
				this._onDidShowUrlEmitter.fire(e);
			}
		}));
	}
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { IRuntimeClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeClientInstance';
import { LanguageRuntimeEventData, LanguageRuntimeEventType } from 'vs/workbench/services/languageRuntime/common/languageRuntimeEvents';


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
	name: LanguageRuntimeEventType;
	data: LanguageRuntimeEventData;
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

	/** The emitter for runtime client events. */
	private readonly _onDidEmitEvent = this._register(new Emitter<IRuntimeClientEvent>());

	/**
	 * Creates a new frontend client instance.
	 *
	 * @param _client The client instance. Takes ownership of the client
	 *   instance and will dispose it when it is disposed.
	 */
	constructor(
		private readonly _client:
			IRuntimeClientInstance<IFrontEndClientMessageInput, IFrontEndClientMessageOutput>,
	) {
		super();
		this._register(this._client);
		this._register(this._client.onDidReceiveData(data => this.handleData(data)));
		this.onDidEmitEvent = this._onDidEmitEvent.event;
	}

	onDidEmitEvent: Event<IRuntimeClientEvent>;

	/**
	 * Handles data received from the backend.
	 *
	 * @param data Data received from the backend.
	 */
	private handleData(data: IFrontEndClientMessageOutput): void {
		switch (data.msg_type) {
			case FrontEndMessageTypeOutput.Event:
				this._onDidEmitEvent.fire(data as IFrontEndClientMessageOutputEvent);
				break;
		}
	}
}

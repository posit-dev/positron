/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { IRuntimeClientInstance, RuntimeClientState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeClientInstance';


/**
 * The types of messages that can be sent to the backend.
 */
export enum HelpMessageTypeInput {
	ShowHelpTopicRequest = 'show_help_topic_request',
}

/**
 * A message used to send data to the backend.
 */
export interface IHelpClientMessageInput {
	msg_type: HelpMessageTypeInput;
}

/**
 * A message requesting help to be shown in the Help pane, with the given topic.
 */
export interface IHelpClientMessageShowHelpTopic extends IHelpClientMessageInput {
	topic: string;
}

/**
 * The types of messages that can be received from the backend.
 */
export enum HelpMessageTypeOutput {
	ShowHelpEvent = 'show_help_event',
	ShowHelpTopicReply = 'show_help_topic_reply',
}

/**
 * A message used to deliver data from the backend to the frontend
 */
export interface IHelpClientMessageOutput {
	msg_type: HelpMessageTypeOutput;
}

// Show help content in the Help pane.
export interface ShowHelpEvent {

	/** The help content to be shown. */
	content: string;

	/** The content help type. Must be one of 'html', 'markdown', or 'url'. */
	kind: string;

	/** Focus the Help pane after the Help content has been rendered? */
	focus: boolean;

}

/**
 * A message requesting content to be shown in the Help pane.
 */
export interface IHelpClientMessageShowHelp
	extends IHelpClientMessageOutput, ShowHelpEvent {
}

/**
 * A reply to a help topic request.
 */
export interface IHelpClientMessageHelpTopicReply extends IHelpClientMessageOutput {
	found: boolean;
}

/**
 * A help client instance.
 */
export class HelpClientInstance extends Disposable {

	/** The emitter for runtime client events. */
	private readonly _onDidEmitHelpContent = this._register(new Emitter<ShowHelpEvent>());

	/** The emitter for the close event. */
	private readonly _onDidClose = this._register(new Emitter<void>());

	/**
	 * Creates a new help client instance.
	 *
	 * @param _client The client instance. Takes ownership of the client
	 *   instance and will dispose it when it is disposed.
	 */
	constructor(
		private readonly _client:
			IRuntimeClientInstance<IHelpClientMessageInput, IHelpClientMessageOutput>,
		readonly languageId: string
	) {
		super();
		this._register(this._client);

		this._register(this._client.onDidReceiveData(data => this.handleData(data)));

		this._register(this._client.onDidChangeClientState(state => {
			// If the client is closed, emit the close event.
			if (state === RuntimeClientState.Closed) {
				this._onDidClose.fire();
			}
		}));

		this.onDidEmitHelpContent = this._onDidEmitHelpContent.event;
		this.onDidClose = this._onDidClose.event;
	}

	/**
	 * Requests that the given help topic be shown in the Help pane. If the
	 * topic was found, a 'show_help' event will be emitted.
	 *
	 * @param topic The topic to show in the Help pane.
	 * @returns A promise that resolves to 'true' if the topic was found, and
	 *   'false' otherwise.
	 */
	async showHelpTopic(topic: string): Promise<boolean> {
		const req: IHelpClientMessageShowHelpTopic = {
			msg_type: HelpMessageTypeInput.ShowHelpTopicRequest,
			topic
		};
		const result = await this._client.performRpc(req);
		if (result.msg_type === HelpMessageTypeOutput.ShowHelpTopicReply) {
			const reply = result as IHelpClientMessageHelpTopicReply;
			return reply.found;
		} else {
			throw new Error(`Unexpected message type: ${result.msg_type}`);
		}
	}

	onDidEmitHelpContent: Event<ShowHelpEvent>;

	onDidClose: Event<void>;

	/**
	 * Handles data received from the backend.
	 *
	 * @param data Data received from the backend.
	 */
	private handleData(data: IHelpClientMessageOutput): void {
		switch (data.msg_type) {
			case HelpMessageTypeOutput.ShowHelpEvent:
				this._onDidEmitHelpContent.fire(data as IHelpClientMessageShowHelp);
				break;
		}
	}
}

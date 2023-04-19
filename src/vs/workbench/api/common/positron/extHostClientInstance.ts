/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import { ILanguageRuntimeMessageCommData, ILanguageRuntimeMessageCommOpen } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { Event, EventEmitter } from 'vscode';

export type ExtHostClientMessageSender = (id: string, data: object) => void;

export class ExtHostRuntimeClientInstance implements positron.RuntimeClientInstance {
	private readonly _onDidChangeClientState = new EventEmitter<positron.RuntimeClientState>();
	private readonly _onDidEmitData = new EventEmitter<object>();
	private _messageCounter = 0;
	private _state: positron.RuntimeClientState;

	constructor(readonly message: ILanguageRuntimeMessageCommOpen,
		readonly sender: ExtHostClientMessageSender) {

		this.onDidChangeClientState = this._onDidChangeClientState.event;
		this.onDidEmitEvent = this._onDidEmitData.event;
		this._state = positron.RuntimeClientState.Connected;
		this.onDidChangeClientState((e) => {
			this._state = e;
		});
	}

	/**
	 * Emits a message from the back end to the client instance.
	 *
	 * @param message The message to emit to the client.
	 */
	emitMessage(message: ILanguageRuntimeMessageCommData): void {
		this._onDidEmitData.fire(message.data);
	}

	/**
	 * Sends a message to the back end.
	 *
	 * @param message The message data to send.
	 */
	sendMessage(data: object): void {
		const id = `${this.getClientId()}-${this._messageCounter++}`;
		this.sender(id, data);
	}

	onDidChangeClientState: Event<positron.RuntimeClientState>;

	onDidEmitEvent: Event<object>;

	getClientState(): positron.RuntimeClientState {
		return this._state;
	}

	getClientId(): string {
		return this.message.comm_id;
	}

	getClientType(): positron.RuntimeClientType {
		return this.message.target_name as positron.RuntimeClientType;
	}

	dispose() {
		throw new Error('Method not implemented.');
	}
}

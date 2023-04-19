/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import { DeferredPromise } from 'vs/base/common/async';
import { ILanguageRuntimeMessageCommData, ILanguageRuntimeMessageCommOpen } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { Event, EventEmitter } from 'vscode';

export type ExtHostClientMessageSender = (id: string, data: object) => void;

export class ExtHostRuntimeClientInstance implements positron.RuntimeClientInstance {
	private readonly _onDidChangeClientState = new EventEmitter<positron.RuntimeClientState>();
	private readonly _onDidEmitData = new EventEmitter<object>();
	private _messageCounter = 0;
	private _state: positron.RuntimeClientState;
	private _pendingRpcs = new Map<string, DeferredPromise<any>>();

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
		// Check to see if this is an RPC response.
		const rpc = this._pendingRpcs.get(message.parent_id);
		if (rpc) {
			// It is, so complete the RPC.
			this._pendingRpcs.delete(message.parent_id);
			rpc.complete(message.data);
		} else {
			// It isn't; treat it like a regular event.
			this._onDidEmitData.fire(message.data);
		}
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

	/**
	 * Performs an RPC call to the back end.
	 */
	performRpc<T>(data: object): Promise<T> {
		// Create an RPC ID and a promise to resolve when the RPC is complete.
		const id = `${this.getClientId()}-${this._messageCounter++}`;
		const rpc = new DeferredPromise<T>();

		// Add the RPC to the pending RPCs map.
		this._pendingRpcs.set(id, rpc);

		// Time out the RPC after 10 seconds.
		setTimeout(() => {
			if (this._pendingRpcs.has(id)) {
				this._pendingRpcs.delete(id);
				rpc.error(new Error('RPC timed out'));
			}
		}, 10000);

		// Send the RPC to the back end and return the promise.
		this.sender(id, data);
		return rpc.p;
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

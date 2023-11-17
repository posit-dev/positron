/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type * as positron from 'positron';
import { DeferredPromise } from 'vs/base/common/async';
import { Event, Emitter } from 'vs/base/common/event';
import { RuntimeClientState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeClientInstance';
import { ILanguageRuntimeMessageCommData, ILanguageRuntimeMessageCommOpen } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

/**
 * A function that sends a message to the back end of a client instance.
 *
 * @param id The message ID. Can be used to correlate requests and responses.
 * @param data The message data.
 */
export type ExtHostClientMessageSender = (id: string, data: object) => void;

/**
 * A client instance that communicates with the back end via a message channel.
 *
 * This instance lives in the extension host, and is typically only used
 * as a proxy when the client instance owned by an extension.
 */
export class ExtHostRuntimeClientInstance implements positron.RuntimeClientInstance {
	// Emitter for client state changes.
	private readonly _onDidChangeClientState = new Emitter<positron.RuntimeClientState>();

	// Emitter for data sent from the back-end to the front end.
	private readonly _onDidSendData = new Emitter<object>();

	// The current client state.
	private _state: positron.RuntimeClientState;

	// The set of pending RPCs (messages that are awaiting a response from the
	// back end)
	private _pendingRpcs = new Map<string, DeferredPromise<any>>();

	// A counter used to generate unique message IDs.
	private _messageCounter = 0;

	/**
	 * Creates a new client instance that lives in the extension host.
	 *
	 * @param message The `comm_open` message that opened the client instance.
	 * @param sender A function that sends a message to the back end.
	 * @param closer A function that closes the back end of the client instance.
	 */
	constructor(readonly message: ILanguageRuntimeMessageCommOpen,
		readonly sender: ExtHostClientMessageSender,
		readonly closer: () => void) {

		this.onDidChangeClientState = this._onDidChangeClientState.event;
		this.onDidSendEvent = this._onDidSendData.event;

		// These instances are created when the runtime emits a `comm_open`
		// message, so they begin in the "connected" state -- the back end is
		// already open.
		this._state = RuntimeClientState.Connected;
		this.onDidChangeClientState((e) => {
			this._state = e;
		});
	}

	/**
	 * Sends a message from the back end to the client instance.
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
			this._onDidSendData.fire(message.data);
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

	/**
	 * The current state of the client instance.
	 */
	onDidChangeClientState: Event<positron.RuntimeClientState>;

	/**
	 * Fires when the back end sends an event to the front end. Events can have
	 * any data type.
	 *
	 * Note that RPC replies don't fire this event; they are returned as
	 * promises from `performRpc`.
	 */
	onDidSendEvent: Event<object>;

	getClientState(): positron.RuntimeClientState {
		return this._state;
	}

	setClientState(state: positron.RuntimeClientState): void {
		this._onDidChangeClientState.fire(state);
	}

	getClientId(): string {
		return this.message.comm_id;
	}

	getClientType(): positron.RuntimeClientType {
		return this.message.target_name as positron.RuntimeClientType;
	}

	dispose() {
		// If the client is still connected, close it.
		if (this._state === RuntimeClientState.Connected) {
			this._onDidChangeClientState.fire(RuntimeClientState.Closing);
			this._onDidChangeClientState.fire(RuntimeClientState.Closed);
			this.closer();
		}
	}
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { JupyterKernel } from './JupyterKernel';

import { JupyterMessagePacket } from './JupyterMessagePacket';
import { JupyterCommMsg } from './JupyterCommMsg';
import { JupyterCommClose } from './JupyterCommClose';
import { PromiseHandles, delay, uuidv4 } from './utils';

/**
 * Adapts a Positron Language Runtime client widget to a Jupyter kernel.
 */
export class RuntimeClientAdapter {

	// Event emitter for state changes
	private readonly _state: vscode.EventEmitter<positron.RuntimeClientState>;
	private _currentState: positron.RuntimeClientState;
	private _disposables: vscode.Disposable[] = [];
	onDidChangeClientState: vscode.Event<positron.RuntimeClientState>;

	/**
	 * Map of pending RPCs. The key is the RPC ID (derived from the message ID),
	 * and the value is a promise that will be resolved when the RPC response is
	 * received.
	 */
	private _pendingRpcs = new Map<string, PromiseHandles<any>>();

	private readonly _messageEmitter = new vscode.EventEmitter<{ [key: string]: any }>();
	readonly onDidReceiveCommMsg = this._messageEmitter.event;

	constructor(
		private readonly _id: string,
		private readonly _type: positron.RuntimeClientType,
		private readonly _params: object,
		private readonly _kernel: JupyterKernel,
		private readonly _server_comm: boolean) {

		// Wire event handlers for state changes
		this._currentState = positron.RuntimeClientState.Uninitialized;
		this._state = new vscode.EventEmitter<positron.RuntimeClientState>();
		this.onDidChangeClientState = this._state.event;
		this._disposables.push(this.onDidChangeClientState((e) => {
			this._currentState = e;

			// Reject all pending RPCs when the channel is closed
			if (e === positron.RuntimeClientState.Closed) {
				for (const [, promise] of this._pendingRpcs) {
					promise.reject(
						new Error(`The channel ${this._id} (${this.getClientType()}) ` +
							` was closed before the RPC completed.`));
				}
			}

		}));

		// Listen to messages from the kernel so we can sort out the ones
		// that are for this comm channel.
		this.onMessage = this.onMessage.bind(this);
		this._kernel.addListener('message', this.onMessage);

		// Bind to status stream from kernel
		this.onStatus = this.onStatus.bind(this);
		this._kernel.addListener('status', this.onStatus);
	}

	/**
	 * Opens the communications channel between the client and the runtime.
	 */
	public async open(): Promise<void> {
		// Ask the kernel to open a comm channel for us
		this._state.fire(positron.RuntimeClientState.Opening);
		await this._kernel.openComm(this._type, this._id, this._params);

		// If not a server comm, resolve immediately. If a server
		// comm, we'll resolve when we get the notification message
		// from the server indicating that it's ready to accept
		// connections.
		//
		// NOTE: If the backend doesn't support this comm type, it
		// will respond with a `comm_close` message. There is a
		// short lapse of time where the comm will resolve, and
		// messages sent during this time might not have any effect.
		if (!this._server_comm) {
			this._state.fire(positron.RuntimeClientState.Connected);
			return;
		}

		const out = new PromiseHandles<void>();
		let connected = false;

		const handler = this.onDidChangeClientState(state => {
			switch (state) {
				case positron.RuntimeClientState.Connected: {
					out.resolve();
					connected = true;
					handler.dispose();
					break;
				}
				case positron.RuntimeClientState.Closing:
				case positron.RuntimeClientState.Closed: {
					out.reject(new Error(`Comm ${this._id} closed before connecting`));
					handler.dispose();
					break;
				}
				default: {
					return;
				}
			}
		});

		await Promise.race([
			out.promise,
			delay(20000),
		]);

		if (!connected) {
			// Send 'comm_close' event and update state to Closed
			this.close();

			const err = `Timeout while connecting to comm ${this._id}`;
			this._kernel.log(err);
			out.reject(new Error(err));
		}

		return out.promise;
	}

	/**
	 * Returns the unique ID of this runtime client.
	 */
	public getId(): string {
		return this._id;
	}

	/**
	 * Gets the current state of the runtime client.
	 */
	public getClientState(): positron.RuntimeClientState {
		return this._currentState;
	}

	/**
	 * Returns the client ID
	 */
	public getClientId(): string {
		return this._id;
	}

	/**
	 * Returns the type of the client
	 */
	public getClientType(): positron.RuntimeClientType {
		return this._type;
	}

	/**
	 * Closes the communications channel between the client and the runtime.
	 */
	public close() {
		// FIXME: Should we set ourselves to Closed here?
		this._state.fire(positron.RuntimeClientState.Closing);
		this._kernel.closeComm(this._id);
	}

	/**
	 * Handles a Jupyter message. If the message is a comm message for this
	 * comm channel, it is forwarded to the client.
	 *
	 * @param msg The message received from the kernel.
	 */
	private onMessage(msg: JupyterMessagePacket) {
		const message = msg.message;
		switch (msg.msgType) {
			case 'comm_msg':
				this.onCommMsg(msg, message as JupyterCommMsg);
				break;
			case 'comm_close':
				this.onCommClose(msg, message as JupyterCommClose);
				break;
		}
		// Ignore other message types
	}

	/**
	 * Responds to a change in the kernel status.
	 *
	 * @param status The new kernel status
	 */
	onStatus(status: positron.RuntimeState) {
		// If the kernel exits while we are connected, we are now closed
		if (status === positron.RuntimeState.Exited &&
			this._currentState === positron.RuntimeClientState.Connected) {
			this._state.fire(positron.RuntimeClientState.Closed);
		}
	}

	/**
	 * Perform an RPC call over the comm channel.
	 */
	performRpc(request: any): Promise<any> {
		// Create a random ID for this request
		const id = uuidv4();

		// Create a promise for the response
		const out = new PromiseHandles<any>();
		this._pendingRpcs.set(id, out);

		// Send the request and return the promise
		this._kernel.sendCommMessage(this._id, id, request);
		return out.promise;
	}

	/**
	 * Process a comm_msg message from the kernel. This usually represents
	 * an event from the server that should be forwarded to the client, or
	 * a response to a request from the client.
	 *
	 * @param _msg The raw message packet received from the kernel.
	 * @param message The contents of the message received from the kernel.
	 */
	private onCommMsg(msg: JupyterMessagePacket, message: JupyterCommMsg) {
		// Ignore messages targeted at other comm channels
		if (message.comm_id !== this._id) {
			return;
		}

		if (this._currentState === positron.RuntimeClientState.Opening) {
			this._state.fire(positron.RuntimeClientState.Connected);

			// Swallow server init message
			if (this._server_comm && message.data.msg_type === 'server_started') {
				return;
			}

			// Otherwise fall through, though this shouldn't happen: if
			// not a server comm, we normally switch to a connected state
			// earlier, before receiving any messages.
		}

		// If this message is in reply to an RPC, fulfill the RPC instead of
		// emitting the message.
		if (this._pendingRpcs.has(msg.originId)) {
			const promise = this._pendingRpcs.get(msg.originId)!;
			if (promise.settled) {
				// If the promise is already settled in some way (resolved or
				// rejected) we can't do anything with it, so just log a
				// warning.
				console.warn(`Ignoring RPC response for ${msg.originId}; ` +
					`RPC already settled (timed out?)`);
			} else {
				// Otherwise, resolve the promise with the message data.
				promise.resolve(message.data);
			}

			// Remove the RPC from the pending list
			this._pendingRpcs.delete(msg.originId);
		} else {

			// Not an RPC response, so emit the message
			this._messageEmitter.fire(message.data);
		}
	}

	/**
	 * Process a comm_close message from the kernel. This should be
	 * somewhat rare, because most channel closures should be initiated
	 * by the client.
	 *
	 * @param _msg The raw message packet received from the kernel.
	 * @param message The contents of the message received from the kernel.
	 */
	private onCommClose(_msg: JupyterMessagePacket, message: JupyterCommClose) {
		// Ignore messages targeted at other comm channels
		if (message.comm_id !== this._id) {
			return;
		}

		// Update the current state to closed
		this._state.fire(positron.RuntimeClientState.Closed);
	}

	/**
	 * Disposes of the runtime client by closing the comm channel.
	 */
	async dispose() {
		this._kernel.removeListener('message', this.onMessage);
		this._kernel.removeListener('status', this.onStatus);

		// If the comm channel is still open, close it from our end.
		if (this.getClientState() === positron.RuntimeClientState.Connected) {
			this._state.fire(positron.RuntimeClientState.Closing);
			await this._kernel.closeComm(this._id);
		}
	}
}

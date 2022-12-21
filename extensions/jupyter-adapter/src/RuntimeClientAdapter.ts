/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { JupyterKernel } from './JupyterKernel';

import { v4 as uuidv4 } from 'uuid';
import { JupyterMessagePacket } from './JupyterMessagePacket';
import { JupyterCommMsg } from './JupyterCommMsg';
import { JupyterCommClose } from './JupyterCommClose';

/**
 * Adapts a Positron Language Runtime client widget to a Jupyter kernel.
 */
export class RuntimeClientAdapter {
	readonly id: string;

	// Event emitter for state changes
	private readonly _state: vscode.EventEmitter<positron.RuntimeClientState>;
	private _currentState: positron.RuntimeClientState;
	private _disposables: vscode.Disposable[] = [];
	onDidChangeClientState: vscode.Event<positron.RuntimeClientState>;

	constructor(
		private readonly _type: positron.RuntimeClientType,
		private readonly _kernel: JupyterKernel) {

		this.id = uuidv4();

		// Wire event handlers for state changes
		this._currentState = positron.RuntimeClientState.Uninitialized;
		this._state = new vscode.EventEmitter<positron.RuntimeClientState>();
		this.onDidChangeClientState = this._state.event;
		this._disposables.push(this.onDidChangeClientState((e) => {
			this._currentState = e;
		}));

		// Listen to messages from the kernel so we can sort out the ones
		// that are for this comm channel.
		this.onMessage = this.onMessage.bind(this);
		this._kernel.addListener('message', this.onMessage);

		// Bind to status stream from kernel
		this.onStatus = this.onStatus.bind(this);
		this._kernel.addListener('status', this.onStatus);

		// Ask the kernel to open a comm channel for us
		this._state.fire(positron.RuntimeClientState.Opening);
		this._kernel.openComm(this._type, this.id, null);

		// Consider the client connected once we've opened the comm
		this._state.fire(positron.RuntimeClientState.Connected);
	}

	/**
	 * Returns the unique ID of this runtime client.
	 */
	public getId(): string {
		return this.id;
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
		return this.id;
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
		this._state.fire(positron.RuntimeClientState.Closing);
		this._kernel.closeComm(this.id);
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
	 * Process a comm_msg message from the kernel. This usually represents
	 * an event from the server that should be forwarded to the client, or
	 * a response to a request from the client.
	 *
	 * @param _msg The raw message packet received from the kernel.
	 * @param message The contents of the message received from the kernel.
	 */
	private onCommMsg(_msg: JupyterMessagePacket, message: JupyterCommMsg) {
		// Ignore messages targeted at other comm channels
		if (message.comm_id !== this.id) {
			return;
		}

		// If we are currently opening, we are now open
		if (this._currentState === positron.RuntimeClientState.Opening) {
			this._state.fire(positron.RuntimeClientState.Connected);
		}

		// TODO: forward message to client
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
		if (message.comm_id !== this.id) {
			return;
		}
		// Update the current state to closed
		this._state.fire(positron.RuntimeClientState.Closed);
	}

	/**
	 * Disposes of the runtime client by closing the comm channel.
	 */
	dispose() {
		this._kernel.removeListener('message', this.onMessage);
		this._kernel.removeListener('status', this.onStatus);

		// If the comm channel is still open, close it from our end.
		if (this.getClientState() === positron.RuntimeClientState.Connected) {
			this._state.fire(positron.RuntimeClientState.Closing);
			this._kernel.closeComm(this.id);
		}
	}
}

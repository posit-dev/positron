/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
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
export class RuntimeClientAdapter implements vscode.Disposable {
	readonly id: string;

	constructor(
		private readonly _type: positron.RuntimeClientType,
		private readonly _kernel: JupyterKernel) {

		this.id = uuidv4();

		// Listen to messages from the kernel so we can sort out the ones
		// that are for this comm channel.
		this.onMessage = this.onMessage.bind(this);
		this._kernel.addListener('message', this.onMessage);

		this._kernel.openComm(this._type, this.id, null);
	}

	/**
	 * Returns the unique ID of this runtime client.
	 */
	public getId(): string {
		return this.id;
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

	private onCommMsg(_msg: JupyterMessagePacket, message: JupyterCommMsg) {
		// Ignore messages targeted at other comm channels
		if (message.comm_id !== this.id) {
			return;
		}
	}

	private onCommClose(_msg: JupyterMessagePacket, message: JupyterCommClose) {
		// Ignore messages targeted at other comm channels
		if (message.comm_id !== this.id) {
			return;
		}
	}

	/**
	 * Disposes of the runtime client by closing the comm channel.
	 */
	dispose() {
		this._kernel.removeListener('message', this.onMessage);
		this._kernel.closeComm(this.id);
	}
}

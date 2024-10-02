/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { JupyterChannel } from './JupyterChannel';
import { JupyterMessageHeader } from './JupyterMessageHeader';
import { WebSocket } from 'ws';

/**
 * Base class for Jupyter commands; commands are messages to the kernel that do
 * not expect a reply.
 */
export abstract class JupyterCommand<T> {
	private _msgId: string = '';

	/**
	 *
	 * @param commandType The type of the command. This is the msg_type field in
	 * the message header.
	 * @param commandPayload The payload of the command. This is the content field
	 * in the message.
	 * @param channel The channel (ZeroMQ socket) to send the command on.
	 */
	constructor(
		public readonly commandType: string,
		public readonly commandPayload: T,
		public readonly channel: JupyterChannel) {
	}

	/**
	 * Creates a unique message ID. This is a random 10-character string.
	 * Derived classes can override this method to provide a different message
	 * ID.
	 *
	 * @returns
	 */
	protected createMsgId(): string {
		return Math.random().toString(16).substring(2, 12);
	}

	/**
	 * Returns the metadata for the message. By default, no metadata is sent;
	 * derived classes can override this method to provide additional metadata.
	 */
	protected get metadata(): any {
		return {};
	}

	/**
	 * Creates the parent header for the message, if any. By default, no parent
	 * header is created; derived classes can override this method to provide a
	 * parent header.
	 */
	protected createParentHeader(): JupyterMessageHeader | null {
		return null;
	}

	get msgId(): string {
		// If we don't have a message ID, create one
		if (!this._msgId) {
			this._msgId = this.createMsgId();
		}
		return this._msgId;
	}

	/**
	 * Deliver the command to the kernel via the given websocket.
	 *
	 * @param sessionId The session ID to send the command to
	 * @param socket
	 */
	public sendCommand(sessionId: string, socket: WebSocket) {
		const header: JupyterMessageHeader = {
			msg_id: this.msgId,
			session: sessionId,
			username: '',
			date: new Date().toISOString(),
			msg_type: this.commandType,
			version: '5.3'
		};
		const payload = {
			header,
			parent_header: this.createParentHeader(),
			metadata: this.metadata,
			content: this.commandPayload,
			channel: this.channel,
			buffers: []
		};
		const text = JSON.stringify(payload);
		socket.send(text);
	}
}

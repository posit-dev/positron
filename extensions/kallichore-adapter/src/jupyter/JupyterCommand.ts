/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { JupyterChannel } from './JupyterChannel';
import { JupyterMessageHeader } from './JupyterMessageHeader';
import { WebSocket } from 'ws';


export abstract class JupyterCommand<T> {
	private _msgId: string = '';
	constructor(
		public readonly commandType: string,
		public readonly commandPayload: T,
		public readonly channel: JupyterChannel) {
	}

	protected createMsgId() {
		return Math.random().toString(16).substring(2, 12);
	}

	get msgId(): string {
		if (!this._msgId) {
			this._msgId = this.createMsgId();
		}
		return this._msgId;
	}

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
			parent_header: null,
			metadata: {},
			content: this.commandPayload,
			channel: this.channel,
			buffers: []
		};
		socket.send(JSON.stringify(payload));
	}
}

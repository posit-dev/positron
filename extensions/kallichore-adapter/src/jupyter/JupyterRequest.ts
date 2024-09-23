/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebSocket } from 'ws';
import { JupyterChannel } from './JupyterChannel';
import { JupyterMessageHeader } from './JupyterMessageHeader';
import { PromiseHandles } from '../async';

export abstract class JupyterRequest<T, U> {
	private _promise: PromiseHandles<U> = new PromiseHandles<U>();
	private _msgId: string;
	constructor(
		public readonly requestType: string,
		public readonly requestPayload: T,
		public readonly replyType: string,
		public readonly channel: JupyterChannel) {
		this._msgId = this.createMsgId();
	}

	public resolve(response: U): void {
		this._promise.resolve(response);
	}

	protected createMsgId() {
		return Math.random().toString(16).substring(2, 12);
	}

	get msgId(): string {
		return this._msgId;
	}

	public send(sessionId: string, socket: WebSocket): Promise<U> {
		const header: JupyterMessageHeader = {
			msg_id: this._msgId,
			session: sessionId,
			username: '',
			date: new Date().toISOString(),
			msg_type: this.requestType,
			version: '5.3'
		};
		const payload = {
			header,
			parent_header: null,
			metadata: {},
			content: this.requestPayload,
			channel: this.channel,
			buffers: []
		};
		socket.send(JSON.stringify(payload));
		return this._promise.promise;
	}
}

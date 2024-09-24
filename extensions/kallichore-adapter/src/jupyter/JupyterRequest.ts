/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebSocket } from 'ws';
import { JupyterChannel } from './JupyterChannel';
import { PromiseHandles } from '../async';
import { JupyterCommand } from './JupyterCommand';

export abstract class JupyterRequest<T, U> extends JupyterCommand<T> {
	private _promise: PromiseHandles<U> = new PromiseHandles<U>();
	constructor(
		requestType: string,
		requestPayload: T,
		public readonly replyType: string,
		channel: JupyterChannel) {
		super(requestType, requestPayload, channel);
	}

	public resolve(response: U): void {
		this._promise.resolve(response);
	}

	public sendRpc(sessionId: string, socket: WebSocket): Promise<U> {
		super.sendCommand(sessionId, socket);
		return this._promise.promise;
	}
}

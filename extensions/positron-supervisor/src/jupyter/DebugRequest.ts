/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DebugProtocol } from '@vscode/debugprotocol';
import { JupyterRequest } from './JupyterRequest';
import { JupyterChannel } from './JupyterChannel';
import { JupyterMessageType } from './JupyterMessageType.js';

export class DebugRequest extends JupyterRequest<DebugProtocol.Request, DebugProtocol.Response> {
	constructor(readonly requestId: string, req: DebugProtocol.Request) {
		super(JupyterMessageType.DebugRequest, req, JupyterMessageType.DebugReply, JupyterChannel.Control);
	}
	protected override createMsgId(): string {
		return this.requestId;
	}
}

/**
 * Represents a debug request message from the Jupyter kernel to the front end.
 *
 * @link https://jupyter-client.readthedocs.io/en/latest/messaging.html#debug-request
 */
export interface JupyterDebugRequest {
	content: DebugProtocol.Request;
}

/**
 * Represents a debug reply message from the Jupyter kernel to the front end.
 *
 * @link https://jupyter-client.readthedocs.io/en/latest/messaging.html#debug-request
 */
export interface JupyterDebugReply {
	content: DebugProtocol.Response;
}

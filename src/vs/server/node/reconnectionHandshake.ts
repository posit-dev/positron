/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { AuthRequest } from '../../platform/remote/common/remoteAgentConnection.js';

export interface IReconnectionInfo {
	readonly reconnectionToken: string;
	readonly isReconnection: boolean;
}

/**
 * Returns the reconnection token and flag a client sent inside its `auth`
 * handshake message, or `fromUrl` when the message does not carry a token.
 *
 * The client puts these values in the WebSocket upgrade URL's query string, but
 * some proxies (SageMaker Studio's, for one) drop that query string while
 * leaving the WebSocket frames intact. The client therefore repeats them in its
 * first handshake message, and the message wins when both are present.
 */
export function resolveReconnectionInfo(msg: AuthRequest, fromUrl: IReconnectionInfo): IReconnectionInfo {
	if (typeof msg.reconnectionToken !== 'string' || msg.reconnectionToken.length === 0) {
		return fromUrl;
	}
	return {
		reconnectionToken: msg.reconnectionToken,
		isReconnection: msg.reconnection === true,
	};
}

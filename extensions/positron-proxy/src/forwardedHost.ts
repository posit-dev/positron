/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ClientRequest, IncomingMessage } from 'http';

/**
 * Records the host the client connected to in `X-Forwarded-Host` on a proxied request.
 *
 * The proxy rewrites `Host` to the app's local address (`changeOrigin`), so without this header
 * the app can't tell which host the browser used. A value already set by an outer proxy is kept.
 * http-proxy's `xfwd` option doesn't cover this: it never adds `X-Forwarded-Host` to WebSocket
 * upgrades.
 */
export function forwardOriginalHost(proxyReq: ClientRequest, req: IncomingMessage): void {
	const host = req.headers['x-forwarded-host'] ?? req.headers.host;
	if (host) {
		proxyReq.setHeader('X-Forwarded-Host', host);
	}
}

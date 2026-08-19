/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as http from 'http';
import type * as net from 'net';
import type { IServerAPI } from './remoteExtensionHostAgentServer.js';

/**
 * Serves an explanatory page when the server has no license, instead of exiting.
 *
 * `server-main.ts` binds the port before it calls `createServer`, so by the time
 * licensing fails we are already holding the port the user's browser (or the
 * proxy in front of it) is pointed at. Exiting there hands them a connection
 * reset or a proxy timeout; keeping the port and answering with a page tells
 * them what actually went wrong. Anything fronting us only needs *some*
 * response on the port -- jupyter-server-proxy's readiness check, for instance,
 * accepts any status -- so no coordination with the wrapper is required.
 *
 * This is the startup case only: the workbench never loads, so there is nothing
 * to tear down. Losing the lease mid-session still exits the process, which
 * leaves connected windows running until it does.
 */

/**
 * The page. Styled inline and standalone: this is served before any workbench
 * asset loads, so none of the product's theme tokens exist yet. It follows the
 * light/dark preference the browser reports rather than picking one.
 */
const LICENSE_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Positron license required</title>
<style>
	:root {
		color-scheme: light dark;
		--surface: #ffffff;
		--page: #f4f4f4;
		--border: #d7d7d7;
		--text: #1f1f1f;
		--muted: #5c5c5c;
		--accent: #1a6fc4;
		--notice: #a8500a;
	}
	@media (prefers-color-scheme: dark) {
		:root {
			--surface: #252526;
			--page: #1e1e1e;
			--border: #3c3c3c;
			--text: #f5f5f5;
			--muted: #b4b4b4;
			--accent: #4daafc;
			--notice: #e5934a;
		}
	}
	body {
		font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
		background: var(--page);
		color: var(--text);
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		margin: 0;
		padding: 1rem;
		box-sizing: border-box;
	}
	.card {
		max-width: 32rem;
		padding: 2.5rem;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface);
	}
	h1 { font-size: 1.3rem; margin-top: 0; }
	p { line-height: 1.5; color: var(--muted); }
	a { color: var(--accent); }
	.tag {
		display: inline-block;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--notice);
		border: 1px solid var(--notice);
		border-radius: 4px;
		padding: 0.15rem 0.5rem;
		margin-bottom: 1rem;
	}
</style>
</head>
<body>
	<div class="card">
		<div class="tag">License required</div>
		<h1>Positron could not be started</h1>
		<p>Positron requires a currently activated license to run, and none could
		be found for this deployment.</p>
		<p>If you believe this is a mistake, check with whoever administers this
		environment about its Positron license configuration.</p>
		<p>To get set up with a Positron license, please contact
		<a href="mailto:sales@posit.co">sales@posit.co</a>.</p>
	</div>
</body>
</html>
`;

/**
 * Creates a server that answers every request with the license page.
 *
 * @returns A server API that `server-main.ts` can drive in place of the real one.
 */
export function createUnlicensedServer(): IServerAPI {
	return {
		unlicensed: true,

		async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
			// 200 rather than an error status: the point of this page is that a
			// person reads it, and an intermediate proxy is far more likely to
			// swallow an error body and substitute its own page. Nothing in the
			// deployment consumes the status as health -- and a proxy's readiness
			// check wants an answer here in any case.
			res.writeHead(200, {
				'Content-Type': 'text/html; charset=utf-8',
				'Cache-Control': 'no-store',
			});
			res.end(LICENSE_PAGE_HTML);
		},

		handleUpgrade(req: http.IncomingMessage, socket: net.Socket, upgradeHead: unknown): void {
			// There is no workbench to connect to. Closing the socket lets the
			// client fall back to a plain request, which gets the page.
			socket.destroy();
		},

		handleServerError(err: Error): void {
			console.error(`Error serving the Positron license page: ${err.message}`);
		},

		dispose(): void {
			// Nothing to release: the license manager owns its own shutdown, and
			// no services were created.
		},
	};
}

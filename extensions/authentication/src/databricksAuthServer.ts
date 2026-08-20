/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as http from 'http';
import type { CancellationToken } from 'vscode';
import {
	DATABRICKS_OAUTH_PORT_MIN,
	DATABRICKS_OAUTH_PORT_MAX,
} from './constants';

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/** Cap on how long start() walks the port range before giving up. */
const DATABRICKS_OAUTH_LISTEN_TIMEOUT_MS = 45_000;

/** Bind errors that mean the host has no usable IPv6 loopback. */
const IPV6_UNAVAILABLE_CODES = new Set([
	'EADDRNOTAVAIL', 'EAFNOSUPPORT', 'EPROTONOSUPPORT', 'EINVAL',
]);

const SUCCESS_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Databricks Sign In</title></head>
<body style="font-family: sans-serif; text-align: center; padding-top: 4em;">
<h2>You are signed in to Databricks. You can close this tab.</h2>
</body>
</html>`;

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function errorHtml(message: string): string {
	return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Databricks Sign In</title></head>
<body style="font-family: sans-serif; text-align: center; padding-top: 4em;">
<h2>Databricks sign-in failed</h2>
<p>${escapeHtml(message)}</p>
</body>
</html>`;
}

/**
 * Minimal loopback HTTP server for the Databricks OAuth U2M flow.
 *
 * The `databricks-cli` public client accepts redirect URIs on ports
 * 8020-8040 (the range the Databricks CLI itself falls back through), so
 * start() walks the range until a port binds, capped at
 * DATABRICKS_OAUTH_LISTEN_TIMEOUT_MS. Binds 127.0.0.1 and, best-effort,
 * ::1 on the same port: the redirect URI names `localhost`, which can
 * resolve to either family. The port range is injectable for tests.
 */
export class DatabricksLoopbackServer {
	private _server: http.Server | undefined;
	private _server6: http.Server | undefined;
	private _port: number | undefined;
	private readonly _codePromise: Promise<string>;
	private _resolveCode!: (code: string) => void;
	private _rejectCode!: (reason: Error) => void;
	private _stopped = false;

	constructor(
		private readonly expectedState: string,
		private readonly portMin: number = DATABRICKS_OAUTH_PORT_MIN,
		private readonly portMax: number = DATABRICKS_OAUTH_PORT_MAX,
	) {
		this._codePromise = new Promise<string>((resolve, reject) => {
			this._resolveCode = resolve;
			this._rejectCode = reject;
		});
		// Avoid an unhandled rejection if the promise settles before
		// waitForCode attaches handlers (e.g. an early bad request).
		this._codePromise.catch(() => { });
	}

	get port(): number {
		if (this._port === undefined) {
			throw new Error('Server is not started');
		}
		return this._port;
	}

	get redirectUri(): string {
		// No trailing slash: the registered redirect URI is
		// `http://localhost:<port>` and the token exchange must send the
		// exact same value.
		return `http://localhost:${this.port}`;
	}

	get ipv6Bound(): boolean {
		return this._server6 !== undefined;
	}

	/** Bind one address, resolving with the server or rejecting on error. */
	private listenOn(port: number, host: string): Promise<http.Server> {
		return new Promise<http.Server>((resolve, reject) => {
			const server = http.createServer(
				(req, res) => this.handleRequest(req, res)
			);
			server.on('error', (err: NodeJS.ErrnoException) => reject(err));
			server.listen(port, host, () => resolve(server));
		});
	}

	/**
	 * Attempt to bind both 127.0.0.1 and, best-effort, ::1 on one port.
	 * Sets `_port` as soon as the IPv4 listener is reachable, since
	 * `handleRequest` (and thus incoming connections) depends on it -
	 * otherwise a request arriving during the ::1 attempt would throw
	 * `Server is not started`. Returns false when the port is unusable
	 * (IPv4 busy, or IPv6 genuinely occupied by another process rather
	 * than merely absent) so the caller can move on to the next candidate.
	 */
	private async tryBindPort(port: number): Promise<boolean> {
		let server: http.Server;
		try {
			server = await this.listenOn(port, '127.0.0.1');
		} catch {
			return false;
		}
		this._server = server;
		this._port = port;
		// Best-effort ::1 listener: `localhost` can resolve to IPv6 first
		// (common on macOS), and an IPv4-only listener would refuse the
		// browser's callback. IPv4 alone is still functional.
		try {
			this._server6 = await this.listenOn(port, '::1');
			return true;
		} catch (err) {
			const code = (err as NodeJS.ErrnoException).code;
			if (IPV6_UNAVAILABLE_CODES.has(code ?? '')) {
				return true;
			}
			if (code !== 'EADDRINUSE') {
				// Not a port-availability error (e.g. resource exhaustion) -
				// walking past it would produce a misleading "No free port".
				await new Promise<void>(resolve => server.close(() => resolve()));
				this._server = undefined;
				this._port = undefined;
				throw err;
			}
			// Another process owns ::1 on this port specifically (not just
			// "no IPv6 on this host"). `localhost` may resolve to it first
			// and receive the authorization code, so this port is unusable.
			await new Promise<void>(resolve => server.close(() => resolve()));
			this._server = undefined;
			this._port = undefined;
			return false;
		}
	}

	/**
	 * Start listening, walking portMin..portMax until a port binds on both
	 * families or, failing IPv6 availability, on IPv4 alone.
	 */
	async start(): Promise<void> {
		if (this._server) {
			throw new Error('Server is already started');
		}
		const deadline = Date.now() + DATABRICKS_OAUTH_LISTEN_TIMEOUT_MS;
		for (let port = this.portMin; port <= this.portMax; port++) {
			if (Date.now() > deadline) {
				break;
			}
			if (await this.tryBindPort(port)) {
				return;
			}
		}
		throw new Error(
			`No free port for Databricks sign-in between ${this.portMin} ` +
			`and ${this.portMax}.`
		);
	}

	private handleRequest(
		req: http.IncomingMessage,
		res: http.ServerResponse
	): void {
		// Accept GET on any path; Databricks redirects to the URI root.
		const reqUrl = new URL(req.url ?? '/', `http://localhost:${this.port}`);
		const code = reqUrl.searchParams.get('code');
		const state = reqUrl.searchParams.get('state');
		const error = reqUrl.searchParams.get('error');
		const errorDescription = reqUrl.searchParams.get('error_description');

		// Browsers request /favicon.ico alongside the redirect; ignore
		// requests that carry no OAuth response parameters.
		if (!code && !state && !error) {
			res.writeHead(404);
			res.end();
			return;
		}

		// The port is predictable and needs no secret to reach, so a callback
		// carrying the wrong state is answered but left unsettled: only the
		// timeout or cancellation ends the wait for the real redirect.
		if (state !== this.expectedState) {
			res.writeHead(400, { 'Content-Type': 'text/html' });
			res.end(errorHtml('State mismatch. Please try signing in again.'));
			return;
		}

		if (error) {
			const message = errorDescription ?? error;
			res.writeHead(400, { 'Content-Type': 'text/html' });
			res.end(errorHtml(message));
			this._rejectCode(new Error(message));
			return;
		}

		if (!code) {
			res.writeHead(400, { 'Content-Type': 'text/html' });
			res.end(errorHtml('Missing authorization code.'));
			this._rejectCode(new Error(
				'Databricks sign-in failed: no authorization code received.'
			));
			return;
		}

		res.writeHead(200, { 'Content-Type': 'text/html' });
		res.end(SUCCESS_HTML);
		this._resolveCode(code);
	}

	/**
	 * Wait for the authorization code, racing a timeout and an optional
	 * cancellation token.
	 */
	waitForCode(
		timeoutMs: number = DEFAULT_TIMEOUT_MS,
		cancellationToken?: CancellationToken
	): Promise<string> {
		return new Promise<string>((resolve, reject) => {
			const timeout = setTimeout(() => {
				reject(new Error(
					'Timed out waiting for Databricks sign-in. Please try again.'
				));
			}, timeoutMs);

			const cancellation = cancellationToken?.onCancellationRequested(() => {
				clearTimeout(timeout);
				reject(new Error('Databricks sign-in was cancelled.'));
			});

			this._codePromise.then(
				code => {
					clearTimeout(timeout);
					cancellation?.dispose();
					resolve(code);
				},
				err => {
					clearTimeout(timeout);
					cancellation?.dispose();
					reject(err);
				}
			);
		});
	}

	/**
	 * Stop the server. Safe to call multiple times.
	 */
	stop(): Promise<void> {
		return new Promise<void>((resolve) => {
			if (this._stopped || !this._server) {
				this._stopped = true;
				resolve();
				return;
			}
			this._stopped = true;
			const servers = [this._server, this._server6]
				.filter((s): s is http.Server => s !== undefined);
			let remaining = servers.length;
			for (const server of servers) {
				server.close(() => {
					if (--remaining === 0) {
						resolve();
					}
				});
				// Close keep-alive connections so close() completes promptly.
				server.closeAllConnections?.();
			}
		});
	}
}

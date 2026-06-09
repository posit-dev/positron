/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as http from 'http';
import type { CancellationToken } from 'vscode';
import { DATABRICKS_OAUTH_REDIRECT_PORT } from './constants';

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

const SUCCESS_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Databricks Sign In</title></head>
<body style="font-family: sans-serif; text-align: center; padding-top: 4em;">
<h2>You are signed in to Databricks. You can close this tab.</h2>
</body>
</html>`;

function errorHtml(message: string): string {
	return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Databricks Sign In</title></head>
<body style="font-family: sans-serif; text-align: center; padding-top: 4em;">
<h2>Databricks sign-in failed</h2>
<p>${message}</p>
</body>
</html>`;
}

/**
 * Minimal loopback HTTP server for the Databricks OAuth U2M flow.
 *
 * Databricks' built-in `databricks-cli` public client only allows the fixed
 * redirect URI http://localhost:8020, so unlike the GitHub loopback server
 * this one must bind a specific port and serves a tiny inline response
 * instead of static media. The port is injectable for tests.
 */
export class DatabricksLoopbackServer {
	private _server: http.Server | undefined;
	private readonly _codePromise: Promise<string>;
	private _resolveCode!: (code: string) => void;
	private _rejectCode!: (reason: Error) => void;
	private _stopped = false;

	constructor(
		private readonly expectedState: string,
		private readonly port: number = DATABRICKS_OAUTH_REDIRECT_PORT,
	) {
		this._codePromise = new Promise<string>((resolve, reject) => {
			this._resolveCode = resolve;
			this._rejectCode = reject;
		});
		// Avoid an unhandled rejection if the promise settles before
		// waitForCode attaches handlers (e.g. an early bad request).
		this._codePromise.catch(() => { });
	}

	/**
	 * Start listening on 127.0.0.1:<port>.
	 */
	start(): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			if (this._server) {
				reject(new Error('Server is already started'));
				return;
			}
			const server = http.createServer(
				(req, res) => this.handleRequest(req, res)
			);
			this._server = server;
			server.on('error', (err: NodeJS.ErrnoException) => {
				if (err.code === 'EADDRINUSE') {
					reject(new Error(
						`Port ${this.port} is already in use. Databricks ` +
						`sign-in requires port ${this.port} - close the ` +
						'application using it, or use a personal access ' +
						'token instead.'
					));
				} else {
					reject(new Error(`Failed to start sign-in server: ${err.message}`));
				}
			});
			server.listen(this.port, '127.0.0.1', () => resolve());
		});
	}

	private handleRequest(
		req: http.IncomingMessage,
		res: http.ServerResponse
	): void {
		// Accept GET on any path; Databricks redirects to the URI root.
		const reqUrl = new URL(req.url ?? '/', `http://127.0.0.1:${this.port}`);
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

		if (error) {
			const message = errorDescription ?? error;
			res.writeHead(400, { 'Content-Type': 'text/html' });
			res.end(errorHtml(message));
			this._rejectCode(new Error(message));
			return;
		}

		if (state !== this.expectedState) {
			res.writeHead(400, { 'Content-Type': 'text/html' });
			res.end(errorHtml('State mismatch. Please try signing in again.'));
			this._rejectCode(new Error(
				'Databricks sign-in failed: state parameter does not match.'
			));
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
			this._server.close(() => resolve());
			// Close keep-alive connections so close() completes promptly.
			this._server.closeAllConnections?.();
		});
	}
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as http from 'http';
import { DeferredPromise } from '../../../base/common/async.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { ILogger, ILoggerService } from '../../log/common/log.js';
import { IPositronMcpServerStatus, IPositronMcpService, POSITRON_MCP_DEFAULT_PORT } from '../common/positronMcp.js';

/**
 * Resolves the `webContents.id` of the window MCP tool calls should be routed
 * to, or `undefined` when no suitable window exists. Injected so the node server
 * never imports the Electron-main windows service directly, which keeps it
 * testable and out of the electron-main layer.
 */
export type WindowSelector = () => number | undefined;

/**
 * Reads the configured port from the environment, falling back to the default.
 * Mirrors the extension's behavior so existing `POSITRON_MCP_PORT` overrides keep
 * working after the move to core.
 */
export function parsePort(): number {
	const raw = process.env.POSITRON_MCP_PORT;
	if (!raw?.trim()) {
		return POSITRON_MCP_DEFAULT_PORT;
	}
	const parsed = Number(raw);
	return Number.isInteger(parsed) && parsed >= 1024 && parsed <= 65535 ? parsed : POSITRON_MCP_DEFAULT_PORT;
}

/**
 * Node implementation of the Positron MCP server.
 *
 * Phase 0: owns the HTTP listener lifecycle on a fixed localhost port and
 * answers a `/health` probe; every other route is 404. JSON-RPC sessions and
 * tool brokering are layered on in later phases. The `windowSelector` is wired
 * now so later phases can route tool calls without changing the constructor.
 */
export class PositronMcpServer extends Disposable implements IPositronMcpService {
	declare readonly _serviceBrand: undefined;

	private readonly _logger: ILogger;
	private readonly _port = parsePort();
	private _server: http.Server | undefined;
	private _startPromise: Promise<void> | undefined;

	constructor(
		private readonly _windowSelector: WindowSelector,
		@ILoggerService loggerService: ILoggerService,
	) {
		super();
		this._logger = this._register(loggerService.createLogger('positronMcp', { name: 'Positron MCP', logLevel: 'always' }));
		this._logger.info('[PositronMcpServer] Initialized');
	}

	async start(): Promise<void> {
		if (this._server?.listening) {
			return;
		}
		if (this._startPromise) {
			return this._startPromise;
		}
		this._startPromise = this._start();
		try {
			await this._startPromise;
		} finally {
			this._startPromise = undefined;
		}
	}

	private async _start(): Promise<void> {
		const { createServer } = await import('http'); // Lazy due to https://github.com/nodejs/node/issues/59686
		const deferred = new DeferredPromise<void>();

		const server = createServer((req, res) => this._handleRequest(req, res));
		this._server = server;

		server.on('listening', () => {
			this._logger.info(`[PositronMcpServer] Listening on http://localhost:${this._port}`);
			deferred.complete();
		});
		server.on('error', (err: NodeJS.ErrnoException) => {
			this._server = undefined;
			this._logger.error(`[PositronMcpServer] Failed to listen on port ${this._port}: ${err}`);
			deferred.error(err);
		});

		server.listen(this._port, 'localhost');
		return deferred.p;
	}

	async stop(): Promise<void> {
		const server = this._server;
		if (!server) {
			return;
		}
		this._server = undefined;
		await new Promise<void>(resolve => server.close(() => resolve()));
		this._logger.info('[PositronMcpServer] Stopped');
	}

	async getStatus(): Promise<IPositronMcpServerStatus> {
		return { running: this._server?.listening ?? false, port: this._port };
	}

	private _handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
		// Phase 0: only a health probe is wired up. The JSON-RPC POST handler and
		// tool broker land in later phases; until then everything else is 404.
		if (req.method === 'GET' && req.url === '/health') {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ status: 'ok', server: 'positron-mcp-server' }));
			return;
		}
		// Reference the selector so it is retained for later phases and so an
		// unused-parameter lint does not fire on the constructor field.
		void this._windowSelector;
		res.writeHead(404, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ error: 'Not found' }));
	}

	override dispose(): void {
		void this.stop();
		super.dispose();
	}
}

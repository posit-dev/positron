/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as http from 'http';
import { DeferredPromise } from '../../../base/common/async.js';
import { Disposable, DisposableMap } from '../../../base/common/lifecycle.js';
import { JsonRpcMessage, JsonRpcProtocol } from '../../../base/common/jsonRpcProtocol.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { ILogger, ILoggerService } from '../../log/common/log.js';
import { IPositronMcpServerStatus, IPositronMcpService, POSITRON_MCP_DEFAULT_PORT } from '../common/positronMcp.js';
import { IMcpCallToolResult } from '../common/positronMcpTools.js';
import { isInitializeMessage, PositronMcpSession, ToolInvoker } from './positronMcpSession.js';

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

	private static readonly SessionHeaderName = 'mcp-session-id';
	/** Cap on a single request body, matching the extension's 1MB limit. */
	private static readonly MaxRequestBytes = 1024 * 1024;

	private readonly _logger: ILogger;
	private readonly _port = parsePort();
	private _server: http.Server | undefined;
	private _startPromise: Promise<void> | undefined;
	private readonly _sessions = this._register(new DisposableMap<string, PositronMcpSession>());

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
		this._sessions.clearAndDisposeAll();
		await new Promise<void>(resolve => server.close(() => resolve()));
		this._logger.info('[PositronMcpServer] Stopped');
	}

	async getStatus(): Promise<IPositronMcpServerStatus> {
		return { running: this._server?.listening ?? false, port: this._port };
	}

	private _handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
		if (req.method === 'OPTIONS') {
			res.writeHead(200).end();
			return;
		}
		if (req.method === 'GET' && req.url === '/health') {
			this._sendJson(res, 200, { status: 'ok', server: 'positron-mcp-server' });
			return;
		}
		if (req.method === 'POST') {
			void this._handlePost(req, res);
			return;
		}
		this._sendJson(res, 404, { error: 'Not found' });
	}

	private async _handlePost(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		const body = await this._readBody(req);
		if (body === undefined) {
			this._sendJson(res, 413, { error: 'Payload too large' });
			return;
		}

		let message: JsonRpcMessage | JsonRpcMessage[];
		try {
			message = JSON.parse(body);
		} catch (error) {
			this._sendJson(res, 400, JsonRpcProtocol.createParseError('Parse error', error instanceof Error ? error.message : String(error)));
			return;
		}

		const session = this._resolveSession(req, message, res);
		if (!session) {
			return;
		}

		try {
			const responses = await session.handleIncoming(message);
			const headers = { 'Content-Type': 'application/json', 'Mcp-Session-Id': session.id };
			// A notification (no id) yields no response body: acknowledge with 202
			// per the Streamable HTTP transport.
			if (responses.length === 0) {
				res.writeHead(202, headers).end();
				return;
			}
			res.writeHead(200, headers).end(JSON.stringify(Array.isArray(message) ? responses : responses[0]));
		} catch (error) {
			this._logger.error(`[PositronMcpServer] Error handling request: ${error}`);
			this._sendJson(res, 500, { error: 'Internal server error' });
		}
	}

	/**
	 * Find the session for a POST, or create one for an `initialize` request that
	 * arrives without a session id. Other id-less requests are rejected.
	 */
	private _resolveSession(req: http.IncomingMessage, message: JsonRpcMessage | JsonRpcMessage[], res: http.ServerResponse): PositronMcpSession | undefined {
		const headerSessionId = this._getSessionId(req);
		if (headerSessionId) {
			const existing = this._sessions.get(headerSessionId);
			if (!existing) {
				this._sendJson(res, 404, { error: 'Session not found' });
				return undefined;
			}
			return existing;
		}

		if (!isInitializeMessage(message)) {
			this._sendJson(res, 400, { error: 'Missing Mcp-Session-Id header' });
			return undefined;
		}

		const sessionId = generateUuid();
		const session = new PositronMcpSession(sessionId, this._logger, this._invokeTool);
		this._sessions.set(sessionId, session);
		this._logger.info(`[PositronMcpServer] Created session ${sessionId}`);
		return session;
	}

	/**
	 * Phase 1 stub: tool calls are not yet routed to a window. Phase 2 replaces
	 * this with a broker that resolves the target window and invokes the renderer
	 * tool registry. The `_windowSelector` is captured here so it is retained.
	 */
	private readonly _invokeTool: ToolInvoker = async (name): Promise<IMcpCallToolResult> => {
		void this._windowSelector;
		return {
			content: [{ type: 'text', text: `Tool '${name}' is not available yet (server still initializing).` }],
			isError: true,
		};
	};

	private _getSessionId(req: http.IncomingMessage): string | undefined {
		const value = req.headers[PositronMcpServer.SessionHeaderName];
		return Array.isArray(value) ? value[0] : value;
	}

	private async _readBody(req: http.IncomingMessage): Promise<string | undefined> {
		const chunks: Buffer[] = [];
		let size = 0;
		for await (const chunk of req) {
			const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			size += buffer.byteLength;
			if (size > PositronMcpServer.MaxRequestBytes) {
				return undefined;
			}
			chunks.push(buffer);
		}
		return Buffer.concat(chunks).toString('utf8');
	}

	private _sendJson(res: http.ServerResponse, statusCode: number, body: object): void {
		res.writeHead(statusCode, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
	}

	override dispose(): void {
		void this.stop();
		super.dispose();
	}
}

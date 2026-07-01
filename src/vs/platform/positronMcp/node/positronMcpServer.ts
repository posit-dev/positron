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
import { IPositronMcpServerStatus, IPositronMcpService, POSITRON_MCP_DEFAULT_PORT, POSITRON_MCP_LOG_ID } from '../common/positronMcp.js';
import { isInitializeMessage, PositronMcpSession } from './positronMcpSession.js';
import { IPositronMcpToolBroker } from './positronMcpToolBroker.js';

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
 * Whether an HTTP Host header refers to this machine. The server is
 * localhost-only, so a request whose Host is some other domain is the hallmark
 * of a DNS-rebinding attack (a malicious page rebinding its domain to
 * 127.0.0.1, which sidesteps the browser's same-origin policy). An absent Host
 * is allowed through, matching the extension's middleware this guard is ported
 * from; the socket is bound to 127.0.0.1 regardless.
 */
export function isLocalHostHeader(hostHeader: string | undefined): boolean {
	const raw = (hostHeader ?? '').trim().toLowerCase();
	if (!raw) {
		return true;
	}
	// Strip the port: an IPv6 host is bracketed ("[::1]:43123"), so the port is
	// whatever follows the closing bracket; otherwise it follows the first colon.
	const host = raw.startsWith('[') ? raw.slice(0, raw.indexOf(']') + 1) : raw.split(':')[0];
	return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host);
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

	// Most-recent client activity, surfaced in the status UI. Cleared on stop so a
	// stopped server never reports a stale client.
	private _lastClientName: string | undefined;
	private _lastClientVersion: string | undefined;
	private _lastActivityAt: number | undefined;

	constructor(
		private readonly _broker: IPositronMcpToolBroker,
		@ILoggerService loggerService: ILoggerService,
	) {
		super();
		this._logger = this._register(loggerService.createLogger(POSITRON_MCP_LOG_ID, { name: 'Positron MCP', logLevel: 'always' }));
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

		// Bind IPv4 explicitly. Binding 'localhost' lets the main process resolve to
		// IPv6 (::1), but existing `.mcp.json` files and `claude mcp add` use
		// http://localhost:43123, and many clients resolve that to 127.0.0.1 first
		// -- so an IPv6-only bind is unreachable for them. The extension and the
		// upstream MCP gateway both bind 127.0.0.1 for the same reason.
		server.listen(this._port, '127.0.0.1');
		return deferred.p;
	}

	async stop(): Promise<void> {
		const server = this._server;
		if (!server) {
			return;
		}
		this._server = undefined;
		this._sessions.clearAndDisposeAll();
		this._lastClientName = undefined;
		this._lastClientVersion = undefined;
		this._lastActivityAt = undefined;
		await new Promise<void>(resolve => server.close(() => resolve()));
		this._logger.info('[PositronMcpServer] Stopped');
	}

	async getStatus(): Promise<IPositronMcpServerStatus> {
		return {
			running: this._server?.listening ?? false,
			port: this._port,
			lastClientName: this._lastClientName,
			lastClientVersion: this._lastClientVersion,
			lastActivityAt: this._lastActivityAt,
		};
	}

	private _handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
		if (!isLocalHostHeader(req.headers.host)) {
			this._logger.warn(`[PositronMcpServer] Blocked request with non-local Host header: ${req.headers.host}`);
			this._sendJson(res, 403, { error: 'Forbidden: non-local Host header' });
			return;
		}
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
			// Record the request for the status UI. The client name is set once the
			// session sees `initialize`, so this reflects it from that point on.
			this._lastActivityAt = Date.now();
			if (session.clientName) {
				this._lastClientName = session.clientName;
				this._lastClientVersion = session.clientVersion;
			}
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
		const session = new PositronMcpSession(sessionId, this._logger, this._broker);
		this._sessions.set(sessionId, session);
		this._logger.info(`[PositronMcpServer] Created session ${sessionId}`);
		return session;
	}

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

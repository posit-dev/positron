/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as http from 'http';
import type { AddressInfo } from 'net';
import { DeferredPromise } from '../../../base/common/async.js';
import { Disposable, DisposableMap } from '../../../base/common/lifecycle.js';
import { JsonRpcMessage, JsonRpcProtocol } from '../../../base/common/jsonRpcProtocol.js';
import { generateUuid, isUUID } from '../../../base/common/uuid.js';
import { ILogger } from '../../log/common/log.js';
import { IPositronMcpWindowOwnStatus } from '../common/positronMcp.js';
import { IPositronMcpAuditLog } from '../common/positronMcpAudit.js';
import { McpContextLedger } from '../common/positronMcpContext.js';
import { isAuthorizedBearer } from './positronMcpToken.js';
import { isInitializeMessage, PositronMcpSession } from './positronMcpSession.js';
import { IPositronMcpToolBroker } from './positronMcpToolBroker.js';

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
 * Node implementation of one window's Positron MCP HTTP server.
 *
 * Owns the HTTP listener lifecycle on an OS-assigned localhost port -- one
 * instance per Positron window, created and destroyed by
 * {@link PositronMcpServerRegistry}. POST carries the JSON-RPC traffic, GET
 * answers a `/health` probe, DELETE tears down a session; any other method
 * gets 405 with an `Allow` header (per the Streamable HTTP spec for servers
 * that offer no SSE stream -- some clients auto-open a GET stream and
 * mishandle a 404 there).
 *
 * A session created by this server is permanently bound to this window: there
 * is no cross-window routing to get right, because a client only ever reaches
 * this server by using this window's own port. Shared state (the bearer
 * token, the audit sink, the user-context ledger) is owned by the registry and
 * injected here, so every window server enforces the same token and feeds the
 * same audit trail.
 */
export class PositronMcpWindowServer extends Disposable {
	private static readonly SessionHeaderName = 'mcp-session-id';
	/** Cap on a single request body, matching the extension's 1MB limit. */
	private static readonly MaxRequestBytes = 1024 * 1024;

	private _server: http.Server | undefined;
	private _port = 0;
	private _startPromise: Promise<void> | undefined;
	private readonly _sessions = this._register(new DisposableMap<string, PositronMcpSession>());

	constructor(
		readonly windowId: number,
		private readonly _token: string,
		private readonly _broker: IPositronMcpToolBroker,
		private readonly _auditSink: IPositronMcpAuditLog,
		private readonly _contextLedger: McpContextLedger,
		private readonly _logger: ILogger,
	) {
		super();
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
			this._port = (server.address() as AddressInfo).port;
			this._logger.info(`[PositronMcpWindowServer ${this.windowId}] Listening on http://localhost:${this._port}`);
			deferred.complete();
		});
		server.on('error', (err: NodeJS.ErrnoException) => {
			this._server = undefined;
			this._logger.error(`[PositronMcpWindowServer ${this.windowId}] Failed to listen: ${err}`);
			deferred.error(err);
		});

		// Bind IPv4 explicitly and let the OS assign a free port: binding
		// 'localhost' lets the main process resolve to IPv6 (::1), which many
		// clients (and their DNS resolution order) don't reach -- see the
		// extension and the upstream MCP gateway, which both bind 127.0.0.1 for
		// the same reason. Each window gets its own port so a terminal spawned
		// from this window can be told, unambiguously, which server is "its own".
		server.listen(0, '127.0.0.1');
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
		this._logger.info(`[PositronMcpWindowServer ${this.windowId}] Stopped`);
	}

	async getStatus(): Promise<IPositronMcpWindowOwnStatus> {
		// Sessions are cleared on stop, so a stopped server never reports a stale
		// client. Map insertion order is creation order, giving oldest-first.
		return {
			running: this._server?.listening ?? false,
			port: this._port,
			sessions: [...this._sessions.values()].map(session => session.info),
		};
	}

	private _handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
		if (!isLocalHostHeader(req.headers.host)) {
			this._logger.warn(`[PositronMcpWindowServer ${this.windowId}] Blocked request with non-local Host header: ${req.headers.host}`);
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
		// Everything else requires the bearer token: it is what stops another
		// local user on a shared machine from reading session data through the
		// consent-free read-only tools. 401 does send Claude Code down an OAuth
		// probe that dead-ends here, but only a misconfigured client ever sees
		// it (a correct config carries the header on every request), and the
		// status panel detects a stale `.mcp.json` and offers the re-add.
		if (!isAuthorizedBearer(req.headers.authorization, this._token)) {
			this._logger.warn(`[PositronMcpWindowServer ${this.windowId}] Rejected request without a valid bearer token`);
			res.writeHead(401, { 'WWW-Authenticate': 'Bearer', 'Content-Type': 'application/json' })
				.end(JSON.stringify({ error: 'Unauthorized: missing or invalid bearer token. Re-add this client\'s Positron MCP configuration from the MCP status panel in Positron.' }));
			return;
		}
		if (req.method === 'POST') {
			void this._handlePost(req, res);
			return;
		}
		if (req.method === 'DELETE') {
			this._handleDelete(req, res);
			return;
		}
		// 405, not 404: a 404 here collides with the stale-session status that
		// Claude Code and Codex mishandle, and the spec says a server offering no
		// GET SSE stream must answer 405.
		res.writeHead(405, { 'Allow': 'POST, DELETE, OPTIONS', 'Content-Type': 'application/json' })
			.end(JSON.stringify({ error: 'Method not allowed' }));
	}

	/**
	 * DELETE is session teardown in the Streamable HTTP transport (VS Code sends
	 * it on shutdown). Idempotent: deleting an unknown or already-gone session
	 * succeeds, since the requested end state holds either way.
	 */
	private _handleDelete(req: http.IncomingMessage, res: http.ServerResponse): void {
		const sessionId = this._getSessionId(req);
		if (!sessionId) {
			this._sendJson(res, 400, { error: 'Missing Mcp-Session-Id header' });
			return;
		}
		const session = this._sessions.get(sessionId);
		if (session) {
			const { clientName, clientVersion } = session;
			this._sessions.deleteAndDispose(sessionId);
			this._auditSink.record({ type: 'session-closed', timestamp: Date.now(), sessionId, clientName, clientVersion, pinnedWindowId: this.windowId });
		}
		this._sendJson(res, 200, { status: 'ok' });
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
			this._logger.error(`[PositronMcpWindowServer ${this.windowId}] Error handling request: ${error}`);
			this._sendJson(res, 500, { error: 'Internal server error' });
		}
	}

	/**
	 * Find the session for a POST, or create one for an `initialize` request that
	 * arrives without a session id. Other id-less requests are rejected.
	 *
	 * A well-formed but unknown session id is resumed rather than 404'd: sessions
	 * are in-memory, so a Positron restart invalidates every connected agent's id,
	 * and the strict-spec 404 is exactly the status Claude Code and Codex fail to
	 * recover from (they break until a manual reconnect). Sessions carry almost no
	 * state -- client name and this window's id, both re-derivable -- so leniency
	 * costs nothing. 404 is kept for ids we could never have issued.
	 */
	private _resolveSession(req: http.IncomingMessage, message: JsonRpcMessage | JsonRpcMessage[], res: http.ServerResponse): PositronMcpSession | undefined {
		const headerSessionId = this._getSessionId(req);
		if (headerSessionId) {
			const existing = this._sessions.get(headerSessionId);
			if (existing) {
				return existing;
			}
			if (!isUUID(headerSessionId)) {
				this._sendJson(res, 404, { error: 'Session not found' });
				return undefined;
			}
			this._logger.warn(`[PositronMcpWindowServer ${this.windowId}] Unknown session id ${headerSessionId}; resuming it as a fresh session (stale id from a previous run?)`);
			const resumed = this._createSession(headerSessionId);
			resumed.resume();
			this._auditSink.record({ type: 'session-resumed', timestamp: Date.now(), sessionId: headerSessionId, pinnedWindowId: this.windowId });
			return resumed;
		}

		if (!isInitializeMessage(message)) {
			this._sendJson(res, 400, { error: 'Missing Mcp-Session-Id header' });
			return undefined;
		}

		const sessionId = generateUuid();
		const session = this._createSession(sessionId);
		this._auditSink.record({ type: 'session-created', timestamp: Date.now(), sessionId, pinnedWindowId: this.windowId });
		return session;
	}

	private _createSession(sessionId: string): PositronMcpSession {
		const session = new PositronMcpSession(sessionId, this._logger, this._broker, this._auditSink, this._contextLedger);
		this._sessions.set(sessionId, session);
		return session;
	}

	private _getSessionId(req: http.IncomingMessage): string | undefined {
		const value = req.headers[PositronMcpWindowServer.SessionHeaderName];
		return Array.isArray(value) ? value[0] : value;
	}

	private async _readBody(req: http.IncomingMessage): Promise<string | undefined> {
		const chunks: Buffer[] = [];
		let size = 0;
		for await (const chunk of req) {
			const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			size += buffer.byteLength;
			if (size > PositronMcpWindowServer.MaxRequestBytes) {
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

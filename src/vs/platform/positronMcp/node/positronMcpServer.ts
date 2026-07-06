/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as http from 'http';
import { DeferredPromise } from '../../../base/common/async.js';
import { Emitter } from '../../../base/common/event.js';
import { Disposable, DisposableMap } from '../../../base/common/lifecycle.js';
import { JsonRpcMessage, JsonRpcProtocol } from '../../../base/common/jsonRpcProtocol.js';
import { generateUuid, isUUID } from '../../../base/common/uuid.js';
import { ILogger, ILoggerService } from '../../log/common/log.js';
import { ITelemetryService } from '../../telemetry/common/telemetry.js';
import { IPositronMcpServerStatus, IPositronMcpService, POSITRON_MCP_DEFAULT_PORT, POSITRON_MCP_LOG_ID } from '../common/positronMcp.js';
import { formatAuditLine, McpAuditEvent, McpAuditLogDetail, McpAuditRingBuffer } from '../common/positronMcpAudit.js';
import { IMcpUserContextData, IMcpUserContextQuery, McpContextEventInput, McpContextLedger } from '../common/positronMcpContext.js';
import { reportMcpTelemetry } from '../common/positronMcpTelemetry.js';
import { McpAuditFileWriter } from './positronMcpAuditFile.js';
import { isAuthorizedBearer, loadOrCreateMcpToken } from './positronMcpToken.js';
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
 * Owns the HTTP listener lifecycle on a fixed localhost port. POST carries the
 * JSON-RPC traffic, GET answers a `/health` probe, DELETE tears down a session;
 * any other method gets 405 with an `Allow` header (per the Streamable HTTP
 * spec for servers that offer no SSE stream -- some clients auto-open a GET
 * stream and mishandle a 404 there).
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

	/**
	 * Recent audit events for the status UI. Intentionally not cleared on
	 * `stop()`: sessions are wiped but the history of what agents did is not.
	 */
	private readonly _recentActivity = new McpAuditRingBuffer(200);

	/**
	 * The user-activity ledger behind get-user-context and the `[context: ...]`
	 * alert lines. A server-lifetime field like the activity buffer: it survives
	 * `stop()` and window reloads, so event seqs stay monotonic for the whole
	 * Positron run and only reset when the app quits.
	 */
	private readonly _contextLedger = new McpContextLedger();
	private readonly _onDidRecordActivity = this._register(new Emitter<McpAuditEvent>());
	// Must be an instance field (not a getter): ProxyChannel.fromService discovers
	// events with a for...in scan of own enumerable properties (ipc.ts).
	readonly onDidRecordActivity = this._onDidRecordActivity.event;

	private readonly _auditFile: McpAuditFileWriter;

	/**
	 * The per-user bearer token every request (except OPTIONS and `/health`)
	 * must present. Loaded once at construction; stable for the process
	 * lifetime, so consumers may cache it.
	 */
	private readonly _token: string;

	constructor(
		private readonly _broker: IPositronMcpToolBroker,
		auditFilePath: string,
		tokenFilePath: string,
		@ILoggerService loggerService: ILoggerService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
	) {
		super();
		this._logger = this._register(loggerService.createLogger(POSITRON_MCP_LOG_ID, { name: 'Positron MCP', logLevel: 'always' }));
		this._auditFile = this._register(new McpAuditFileWriter(auditFilePath, this._logger));
		this._token = loadOrCreateMcpToken(tokenFilePath, message => this._logger.warn(`[PositronMcpServer] ${message}`));
		this._logger.info('[PositronMcpServer] Initialized');
	}

	/**
	 * Adopt the renderer's `positron.mcp.auditLog.detail` value. The main process
	 * cannot read workbench settings, so the lifecycle contribution pushes it here
	 * at startup and whenever it changes; multiple windows push the same value
	 * idempotently. Applies from the next audit event.
	 */
	async setAuditLogDetail(detail: McpAuditLogDetail): Promise<void> {
		this._auditFile.detail = detail;
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
		await new Promise<void>(resolve => server.close(() => resolve()));
		this._logger.info('[PositronMcpServer] Stopped');
	}

	async getStatus(): Promise<IPositronMcpServerStatus> {
		// Sessions are cleared on stop, so a stopped server never reports a stale
		// client. Map insertion order is creation order, giving oldest-first.
		return {
			running: this._server?.listening ?? false,
			port: this._port,
			token: this._token,
			sessions: [...this._sessions.values()].map(session => session.info),
			recentActivity: this._recentActivity.snapshot(),
			auditLogPath: this._auditFile.path,
		};
	}

	async recordContextEvent(event: McpContextEventInput): Promise<void> {
		this._contextLedger.record(event);
	}

	async queryUserContext(query: IMcpUserContextQuery): Promise<IMcpUserContextData> {
		// Scope to the requesting session's pinned window so a client only sees
		// activity from the window its tools run in. An unknown session (or one
		// with no pinned window yet) gets the unscoped view.
		const windowId = this._sessions.get(query.mcpSessionId)?.info.pinnedWindowId;
		return this._contextLedger.query(query, windowId);
	}

	/**
	 * The audit sink every session records into. Start events only feed the live
	 * activity emitter (transient in-flight state); completed calls and lifecycle
	 * events also land in the log channel, the ring buffer, and the JSONL audit
	 * file. Only the file sink ever sees complete tool arguments: everything
	 * downstream of it gets the summary-only event, so full argument values
	 * never reach the ring buffer, the status poll, or the renderer emitter.
	 */
	private _recordAudit(event: McpAuditEvent): void {
		this._auditFile.write(event);
		if (event.type === 'tool-call' && (event.args !== undefined || event.contextAlert !== undefined)) {
			const { args: _args, contextAlert: _contextAlert, ...summaryOnly } = event;
			event = summaryOnly;
		}
		if (event.type === 'tool-call-start') {
			this._logger.debug(formatAuditLine(event));
		} else {
			this._logger.info(formatAuditLine(event));
			this._recentActivity.push(event);
		}
		reportMcpTelemetry(this._telemetryService, event);
		this._onDidRecordActivity.fire(event);
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
		// Everything else requires the bearer token: it is what stops another
		// local user on a shared machine from reading session data through the
		// consent-free read-only tools. 401 does send Claude Code down an OAuth
		// probe that dead-ends here, but only a misconfigured client ever sees
		// it (a correct config carries the header on every request), and the
		// status panel detects a stale `.mcp.json` and offers the re-add.
		if (!isAuthorizedBearer(req.headers.authorization, this._token)) {
			this._logger.warn('[PositronMcpServer] Rejected request without a valid bearer token');
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
			this._recordAudit({ type: 'session-closed', timestamp: Date.now(), sessionId, clientName, clientVersion });
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
			this._logger.error(`[PositronMcpServer] Error handling request: ${error}`);
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
	 * state -- client name and a pinned window, both re-derivable -- so leniency
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
			this._logger.warn(`[PositronMcpServer] Unknown session id ${headerSessionId}; resuming it as a fresh session (stale id from a previous run?)`);
			const resumed = this._createSession(headerSessionId);
			resumed.resume();
			this._recordAudit({ type: 'session-resumed', timestamp: Date.now(), sessionId: headerSessionId });
			return resumed;
		}

		if (!isInitializeMessage(message)) {
			this._sendJson(res, 400, { error: 'Missing Mcp-Session-Id header' });
			return undefined;
		}

		const sessionId = generateUuid();
		const session = this._createSession(sessionId);
		this._recordAudit({ type: 'session-created', timestamp: Date.now(), sessionId });
		return session;
	}

	private _createSession(sessionId: string): PositronMcpSession {
		const session = new PositronMcpSession(sessionId, this._logger, this._broker, { record: e => this._recordAudit(e) }, this._contextLedger);
		this._sessions.set(sessionId, session);
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

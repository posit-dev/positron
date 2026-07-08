/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../base/common/lifecycle.js';
import { raceTimeout } from '../../../base/common/async.js';
import {
	IJsonRpcNotification,
	IJsonRpcRequest,
	JsonRpcError,
	JsonRpcMessage,
	JsonRpcProtocol,
	JsonRpcResponse,
} from '../../../base/common/jsonRpcProtocol.js';
import { hasKey } from '../../../base/common/types.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { ILogger } from '../../log/common/log.js';
import { IMcpCallerContext, IMcpSessionInfo } from '../common/positronMcp.js';
import { IPositronMcpAuditLog, summarizeArgs, summarizeResult } from '../common/positronMcpAudit.js';
import { McpContextLedger } from '../common/positronMcpContext.js';
import { GET_GUIDANCE_TOOL, getGuidance } from '../common/positronMcpGuides.js';
import {
	IMcpCallToolResult,
	mcpToolError,
	NO_ACTIVE_SESSION_TEXT,
	POSITRON_MCP_PROTOCOL_VERSION,
	POSITRON_MCP_SERVER_INFO,
	POSITRON_MCP_TOOLS,
	SERVER_INSTRUCTIONS,
} from '../common/positronMcpTools.js';
import { IPositronMcpToolBroker } from './positronMcpToolBroker.js';

/** JSON-RPC error codes used by the MCP session. */
const MCP_INVALID_REQUEST = -32600;
const MCP_METHOD_NOT_FOUND = -32601;

/**
 * Returns true when a message (or the first of a batch) is an `initialize`
 * request -- used to decide whether a POST without a session id may open a new
 * session. Mirrors the upstream gateway's `isInitializeMessage`.
 */
export function isInitializeMessage(message: JsonRpcMessage | JsonRpcMessage[]): boolean {
	const first = Array.isArray(message) ? message[0] : message;
	return !!first && hasKey(first, { method: true }) && first.method === 'initialize';
}

/**
 * One MCP session over the Streamable HTTP transport. Owns a {@link JsonRpcProtocol}
 * and dispatches the MCP methods. `initialize`, `tools/list`, and `ping` are
 * answered entirely here (no window needed); `tools/call` is routed to the
 * session's window via the {@link IPositronMcpToolBroker}.
 *
 * A session belongs to exactly one window for its entire lifetime: it is
 * created by that window's own {@link PositronMcpWindowServer}, so
 * `_broker.windowId` is fixed from construction (there is nothing to resolve
 * or re-resolve). If that window's renderer is not connected, a tool call
 * returns a clean error rather than hanging or throwing.
 */
export class PositronMcpSession extends Disposable {
	private readonly _rpc: JsonRpcProtocol;
	private _initialized = false;

	/** Name the client reported at `initialize` (e.g. "claude-code"), for status UI. */
	public clientName: string | undefined;
	/** Version the client reported at `initialize`, for status UI. */
	public clientVersion: string | undefined;

	/** When the session was created; a session is created by its `initialize` request. */
	private readonly _createdAt = Date.now();
	/** When the session last received a message. */
	private _lastActivityAt = this._createdAt;

	/** The caller identity threaded into brokered tool calls. */
	private get _callerContext(): IMcpCallerContext {
		return { mcpSessionId: this.id, clientName: this.clientName, clientVersion: this.clientVersion };
	}

	/** A status-UI snapshot of this session. */
	get info(): IMcpSessionInfo {
		return {
			sessionId: this.id,
			clientName: this.clientName,
			clientVersion: this.clientVersion,
			createdAt: this._createdAt,
			lastActivityAt: this._lastActivityAt,
			pinnedWindowId: this._broker.windowId,
		};
	}

	constructor(
		public readonly id: string,
		private readonly _logger: ILogger,
		private readonly _broker: IPositronMcpToolBroker,
		private readonly _audit: IPositronMcpAuditLog,
		private readonly _contextLedger: McpContextLedger,
	) {
		super();
		// New sessions are only alerted about activity from this point on; a
		// session resumed under a known id keeps its existing cursor.
		this._contextLedger.ensureCursor(id);
		// The session is request/response over POST: responses come back from
		// handleMessage's return value, so the send callback is a no-op sink.
		this._rpc = this._register(new JsonRpcProtocol(
			() => { /* responses are returned by handleIncoming, not pushed */ },
			{
				handleRequest: (request, _token) => this._handleRequest(request),
				handleNotification: notification => this._handleNotification(notification),
			},
		));
	}

	/**
	 * Mark this session as already initialized. Used when the server leniently
	 * resumes a stale session id after a restart: the client believes it completed
	 * the handshake long ago and will send `tools/call` straight away, so the
	 * session must not reject it as uninitialized. The client stays anonymous
	 * until (unless) it re-initializes; the window is already known (the
	 * resumed session is created by the same window's server as before).
	 */
	resume(): void {
		this._initialized = true;
	}

	/** Handle an incoming message (or batch) and return the JSON-RPC responses. */
	async handleIncoming(message: JsonRpcMessage | JsonRpcMessage[]): Promise<JsonRpcResponse[]> {
		this._lastActivityAt = Date.now();
		return this._rpc.handleMessage(message);
	}

	private _handleNotification(notification: IJsonRpcNotification): void {
		// `notifications/initialized` confirms the handshake; nothing else to do.
		this._logger.debug(`[PositronMcpSession ${this.id}] notification: ${notification.method}`);
	}

	private async _handleRequest(request: IJsonRpcRequest): Promise<unknown> {
		if (request.method === 'initialize') {
			this._initialized = true;
			const clientInfo = (request.params as { clientInfo?: { name?: unknown; version?: unknown } } | undefined)?.clientInfo;
			if (clientInfo?.name) {
				this.clientName = String(clientInfo.name);
				this.clientVersion = clientInfo.version !== undefined ? String(clientInfo.version) : undefined;
			}
			this._audit.record({
				type: 'client-identified',
				timestamp: Date.now(),
				sessionId: this.id,
				clientName: this.clientName,
				clientVersion: this.clientVersion,
				pinnedWindowId: this._broker.windowId,
			});
			return {
				protocolVersion: POSITRON_MCP_PROTOCOL_VERSION,
				capabilities: { tools: {} },
				serverInfo: POSITRON_MCP_SERVER_INFO,
				instructions: await this._buildInstructions(),
			};
		}

		if (!this._initialized) {
			throw new JsonRpcError(MCP_INVALID_REQUEST, 'Session is not initialized');
		}

		switch (request.method) {
			case 'ping':
				return {};
			case 'tools/list':
				// The descriptor type is exactly the wire shape, so the list is
				// returned as-is (JSON.stringify drops an absent `annotations`).
				// get-guidance is appended here because it is served by the main
				// process, not the renderer handler table behind POSITRON_MCP_TOOLS.
				return { tools: [...POSITRON_MCP_TOOLS, GET_GUIDANCE_TOOL] };
			case 'tools/call': {
				const params = (request.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
				if (!params.name) {
					throw new JsonRpcError(MCP_INVALID_REQUEST, 'tools/call requires a tool name');
				}
				return this._callTool(params.name, params.arguments ?? {});
			}
			default:
				throw new JsonRpcError(MCP_METHOD_NOT_FOUND, `Method not found: ${request.method}`);
		}
	}

	/**
	 * How long the initialize handshake waits for the live session snapshot
	 * before serving the static instructions. Short: a snapshot is a nicety,
	 * and a slow renderer must not stall the client's connection.
	 */
	private static readonly SnapshotTimeoutMs = 1500;

	/**
	 * The static guidance plus, when this session's window has a live runtime
	 * session, a snapshot of it (language, version, interpreter path) so the
	 * model runs the right language from its first message instead of guessing
	 * or spending a tool call on get-session. Reuses the get-session tool over
	 * the existing broker channel rather than adding IPC surface. Any failure
	 * -- window not connected, timeout, error, or no active session -- falls
	 * back to the static text; the handshake never fails because of the snapshot.
	 */
	private async _buildInstructions(): Promise<string> {
		if (!this._broker.isConnected()) {
			return SERVER_INSTRUCTIONS;
		}
		try {
			const result = await raceTimeout(
				this._broker.invokeTool('get-session', {}, this._callerContext),
				PositronMcpSession.SnapshotTimeoutMs,
			);
			const first = result && !result.isError ? result.content[0] : undefined;
			if (first?.type === 'text' && first.text !== NO_ACTIVE_SESSION_TEXT) {
				return `${SERVER_INSTRUCTIONS}\n\nThe active session right now (a connection-time snapshot; re-check with get-session if the user may have switched):\n${first.text}`;
			}
		} catch {
			// Fall through to the static instructions.
		}
		return SERVER_INSTRUCTIONS;
	}

	/**
	 * Route a tool call to this session's window. Returns a tool-level error
	 * (not a thrown exception) when the window's renderer is not connected, so
	 * the model gets a recoverable message instead of the call hanging or
	 * failing the transport.
	 */
	private async _callTool(name: string, args: Record<string, unknown>): Promise<IMcpCallToolResult> {
		const callId = generateUuid();
		const startedAt = Date.now();
		const windowId = this._broker.windowId;
		this._logger.debug(`[PositronMcpSession ${this.id}] tools/call ${name}(${Object.keys(args).join(', ')})`);
		this._audit.record({
			type: 'tool-call-start',
			callId,
			timestamp: startedAt,
			sessionId: this.id,
			clientName: this.clientName,
			toolName: name,
			pinnedWindowId: windowId,
		});

		// Every exit path funnels through this so exactly one completion event is
		// recorded per call -- the status bar pairs it with the start event above.
		// This is also where the user-context alert is appended: the ledger's
		// per-client cursor means each event is alerted at most once, and a
		// result that itself reported context events (auditHint) advances the
		// cursor instead of echoing them back as an alert.
		const complete = (handlerResult: IMcpCallToolResult): IMcpCallToolResult => {
			const auditHint = handlerResult.auditHint;
			// Rebuild the wire result by projecting the MCP wire fields, rather
			// than deleting known-internal ones: any future internal field a
			// handler attaches stays behind this choke point by construction.
			// The content array is copied so the alert push below never mutates
			// the handler's object.
			const result: IMcpCallToolResult = { content: [...handlerResult.content], isError: handlerResult.isError };
			let contextAlert: string | undefined;
			if (auditHint?.advanceContextCursor !== undefined) {
				this._contextLedger.advanceCursorForReport(this.id, auditHint.advanceContextCursor.to, auditHint.advanceContextCursor.reportedSince);
			} else {
				contextAlert = this._contextLedger.consumeAlert(this.id, windowId);
				if (contextAlert !== undefined) {
					result.content.push({ type: 'text', text: contextAlert });
				}
			}
			this._audit.record({
				type: 'tool-call',
				callId,
				timestamp: Date.now(),
				sessionId: this.id,
				clientName: this.clientName,
				clientVersion: this.clientVersion,
				toolName: name,
				argsSummary: summarizeArgs(args),
				args,
				outcome: result.isError ? 'error' : 'ok',
				durationMs: Date.now() - startedAt,
				pinnedWindowId: windowId,
				resultSummary: summarizeResult(result),
				contextAlert,
				returnedConsoleContent: auditHint?.returnedConsoleContent,
			});
			return result;
		};

		// get-guidance is static content served entirely by the main process:
		// answer it without needing the window connected. It still flows through
		// the audit choke point above and below.
		if (name === GET_GUIDANCE_TOOL.name) {
			return complete(getGuidance(args));
		}

		if (!this._broker.isConnected()) {
			return complete(mcpToolError('This Positron window is not available to run this. Reconnect from a live Positron window and try again.'));
		}

		try {
			return complete(await this._broker.invokeTool(name, args, this._callerContext));
		} catch (error) {
			// A window that closes mid-call rejects the pending IPC call; surface it
			// as a recoverable tool error rather than a transport failure.
			return complete(mcpToolError(`Failed to run ${name} in the Positron window: ${error instanceof Error ? error.message : String(error)}`));
		}
	}
}

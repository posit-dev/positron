/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../base/common/lifecycle.js';
import {
	IJsonRpcNotification,
	IJsonRpcRequest,
	JsonRpcError,
	JsonRpcMessage,
	JsonRpcProtocol,
	JsonRpcResponse,
} from '../../../base/common/jsonRpcProtocol.js';
import { hasKey } from '../../../base/common/types.js';
import { ILogger } from '../../log/common/log.js';
import {
	IMcpCallToolResult,
	McpContent,
	POSITRON_MCP_PROTOCOL_VERSION,
	POSITRON_MCP_SERVER_INFO,
	POSITRON_MCP_TOOLS,
	SERVER_INSTRUCTIONS,
} from '../common/positronMcpTools.js';
import { IPositronMcpToolBroker } from './positronMcpToolBroker.js';

/** JSON-RPC error codes used by the MCP session. */
const MCP_INVALID_REQUEST = -32600;
const MCP_METHOD_NOT_FOUND = -32601;

/** A tool result that reports an error to the model rather than failing the call. */
function toolError(text: string): IMcpCallToolResult {
	const content: McpContent[] = [{ type: 'text', text }];
	return { content, isError: true };
}

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
 * session's pinned window via the {@link IPositronMcpToolBroker}.
 *
 * Window pinning: the session resolves a target window once at `initialize` and
 * keeps using it, so every tool call in one agent conversation hits the same
 * window's session even if focus moves. If the pinned window closes, the next
 * tool call re-resolves to the current last-active window; if none exists, the
 * call returns a clean error (never hangs).
 */
export class PositronMcpSession extends Disposable {
	private readonly _rpc: JsonRpcProtocol;
	private _initialized = false;
	private _pinnedWindowId: number | undefined;

	/** Name the client reported at `initialize` (e.g. "claude-code"), for status UI. */
	public clientName: string | undefined;
	/** Version the client reported at `initialize`, for status UI. */
	public clientVersion: string | undefined;

	constructor(
		public readonly id: string,
		private readonly _logger: ILogger,
		private readonly _broker: IPositronMcpToolBroker,
	) {
		super();
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

	/** Handle an incoming message (or batch) and return the JSON-RPC responses. */
	async handleIncoming(message: JsonRpcMessage | JsonRpcMessage[]): Promise<JsonRpcResponse[]> {
		return this._rpc.handleMessage(message);
	}

	private _handleNotification(notification: IJsonRpcNotification): void {
		// `notifications/initialized` confirms the handshake; nothing else to do.
		this._logger.debug(`[PositronMcpSession ${this.id}] notification: ${notification.method}`);
	}

	private async _handleRequest(request: IJsonRpcRequest): Promise<unknown> {
		if (request.method === 'initialize') {
			this._initialized = true;
			this._pinnedWindowId = this._broker.resolveTargetWindow();
			const clientInfo = (request.params as { clientInfo?: { name?: unknown; version?: unknown } } | undefined)?.clientInfo;
			if (clientInfo?.name) {
				this.clientName = String(clientInfo.name);
				this.clientVersion = clientInfo.version !== undefined ? String(clientInfo.version) : undefined;
				this._logger.info(`[PositronMcpSession ${this.id}] initialize from ${this.clientName}${this.clientVersion ? ` ${this.clientVersion}` : ''} (window ${this._pinnedWindowId ?? 'none'})`);
			}
			return {
				protocolVersion: POSITRON_MCP_PROTOCOL_VERSION,
				capabilities: { tools: {} },
				serverInfo: POSITRON_MCP_SERVER_INFO,
				instructions: SERVER_INSTRUCTIONS,
			};
		}

		if (!this._initialized) {
			throw new JsonRpcError(MCP_INVALID_REQUEST, 'Session is not initialized');
		}

		switch (request.method) {
			case 'ping':
				return {};
			case 'tools/list':
				return {
					tools: POSITRON_MCP_TOOLS.map(({ name, description, inputSchema, annotations }) =>
						annotations ? { name, description, inputSchema, annotations } : { name, description, inputSchema }),
				};
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
	 * Route a tool call to this session's pinned window. Re-resolves the target if
	 * the pinned window has closed, and returns a tool-level error (not a thrown
	 * exception) when no live window is available, so the model gets a recoverable
	 * message instead of the call hanging or failing the transport.
	 */
	private async _callTool(name: string, args: Record<string, unknown>): Promise<IMcpCallToolResult> {
		// Audit line: record every tool call (name + argument keys) so the "Positron
		// MCP" log channel is a timeline of what the agent did in the session.
		this._logger.info(`[PositronMcpSession ${this.id}] tools/call ${name}(${Object.keys(args).join(', ')})`);

		// Re-resolve if the pinned window is gone (or was never set).
		if (this._pinnedWindowId === undefined || !this._broker.isWindowConnected(this._pinnedWindowId)) {
			const reResolved = this._broker.resolveTargetWindow();
			this._logger.info(`[PositronMcpSession ${this.id}] pinned window unavailable; re-pinned to ${reResolved ?? 'none'}`);
			this._pinnedWindowId = reResolved;
		}

		if (this._pinnedWindowId === undefined || !this._broker.isWindowConnected(this._pinnedWindowId)) {
			return toolError('No Positron window is available to run this. Open a Positron window and try again.');
		}

		try {
			return await this._broker.invokeTool(this._pinnedWindowId, name, args);
		} catch (error) {
			// A window that closes mid-call rejects the pending IPC call; surface it
			// as a recoverable tool error rather than a transport failure.
			return toolError(`Failed to run ${name} in the Positron window: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
}

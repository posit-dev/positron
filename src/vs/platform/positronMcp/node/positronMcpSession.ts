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
	POSITRON_MCP_PROTOCOL_VERSION,
	POSITRON_MCP_SERVER_INFO,
	POSITRON_MCP_TOOLS,
	SERVER_INSTRUCTIONS,
} from '../common/positronMcpTools.js';

/** JSON-RPC error codes used by the MCP session. */
const MCP_INVALID_REQUEST = -32600;
const MCP_METHOD_NOT_FOUND = -32601;

/**
 * Invokes a named tool with its arguments and returns the MCP result. The
 * session is transport-only; the real implementation (renderer tool broker,
 * window routing, consent) is injected by the server. Until Phase 2 wires the
 * broker, the server supplies a stub that reports the tool is not yet available.
 */
export type ToolInvoker = (name: string, args: Record<string, unknown>) => Promise<IMcpCallToolResult>;

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
 * answered entirely here (no window needed); `tools/call` forwards to the
 * injected {@link ToolInvoker}.
 */
export class PositronMcpSession extends Disposable {
	private readonly _rpc: JsonRpcProtocol;
	private _initialized = false;

	constructor(
		public readonly id: string,
		private readonly _logger: ILogger,
		private readonly _invokeTool: ToolInvoker,
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
			const clientInfo = (request.params as { clientInfo?: { name?: unknown; version?: unknown } } | undefined)?.clientInfo;
			if (clientInfo?.name) {
				this._logger.info(`[PositronMcpSession ${this.id}] initialize from ${String(clientInfo.name)}${clientInfo.version ? ` ${String(clientInfo.version)}` : ''}`);
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
				return this._invokeTool(params.name, params.arguments ?? {});
			}
			default:
				throw new JsonRpcError(MCP_METHOD_NOT_FOUND, `Method not found: ${request.method}`);
		}
	}
}

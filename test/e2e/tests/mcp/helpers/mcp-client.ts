/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/** One content block of a tool result. */
export interface McpContentBlock {
	type: string;
	text?: string;
	data?: string;
	mimeType?: string;
}

/** The result of a `tools/call`. */
export interface McpToolResult {
	content: McpContentBlock[];
	structuredContent?: Record<string, unknown>;
	isError?: boolean;
	_meta?: Record<string, unknown>;
}

/** The joined text of a tool result's text blocks. */
export function toolResultText(result: McpToolResult): string {
	return result.content
		.filter(block => block.type === 'text')
		.map(block => block.text ?? '')
		.join('\n');
}

/**
 * A minimal Streamable HTTP client for the supervisor's MCP server, standing in
 * for a coding agent.
 *
 * Deliberately dependency-free: the protocol an agent speaks over the wire is
 * exactly what these tests need to cover, so speaking it directly keeps the
 * test honest about the contract and free of an SDK's own negotiation.
 */
export class McpTestClient {
	private _nextId = 0;
	private _sessionId: string | undefined;

	/**
	 * @param url The MCP endpoint, e.g. `http://127.0.0.1:39000/mcp`.
	 * @param token The bearer token Positron published for this window.
	 * @param clientName The name the server records as the agent's identity.
	 */
	constructor(
		private readonly url: string,
		private readonly token: string,
		private readonly clientName = 'positron-e2e',
	) { }

	/** Complete the handshake. Must be called before any other request. */
	async initialize(): Promise<Record<string, unknown>> {
		const result = await this.request('initialize', {
			protocolVersion: '2025-06-18',
			capabilities: {},
			clientInfo: { name: this.clientName, version: '1.0.0' },
		});
		await this.notify('notifications/initialized');
		return result as Record<string, unknown>;
	}

	/** The names of the tools the server offers. */
	async listTools(): Promise<string[]> {
		const result = await this.request('tools/list') as { tools: { name: string }[] };
		return result.tools.map(tool => tool.name);
	}

	/**
	 * Call a tool.
	 *
	 * @param name The tool name, without an agent-applied prefix.
	 * @param args The tool's arguments.
	 * @returns The tool result, including error results (which are not thrown).
	 */
	async callTool(name: string, args: Record<string, unknown> = {}): Promise<McpToolResult> {
		return await this.request('tools/call', { name, arguments: args }) as McpToolResult;
	}

	/** Issue a JSON-RPC request and return its result. */
	private async request(method: string, params?: unknown): Promise<unknown> {
		const id = ++this._nextId;
		const response = await this.post({ jsonrpc: '2.0', id, method, params });
		const body = await response.text();
		const message = parseResponse(body);
		if (!message) {
			throw new Error(`MCP ${method} returned no JSON-RPC response: ${body}`);
		}
		if (message.error) {
			throw new Error(`MCP ${method} failed: ${message.error.message}`);
		}
		return message.result;
	}

	/** Issue a JSON-RPC notification, which has no reply. */
	private async notify(method: string, params?: unknown): Promise<void> {
		await this.post({ jsonrpc: '2.0', method, params });
	}

	/** POST a JSON-RPC message, carrying the session along once we have one. */
	private async post(message: object): Promise<Response> {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			'Accept': 'application/json, text/event-stream',
			'Authorization': `Bearer ${this.token}`,
		};
		if (this._sessionId) {
			headers['Mcp-Session-Id'] = this._sessionId;
		}

		const response = await fetch(this.url, {
			method: 'POST',
			headers,
			body: JSON.stringify(message),
		});

		// The server assigns a session on the older protocol revisions; on the
		// newest it is stateless and sends no header.
		const sessionId = response.headers.get('mcp-session-id');
		if (sessionId) {
			this._sessionId = sessionId;
		}

		if (!response.ok) {
			throw new Error(
				`MCP request failed: ${response.status} ${response.statusText}\n` +
				`${await response.text()}`);
		}
		return response;
	}
}

/** A JSON-RPC response, however the server chose to frame it. */
interface JsonRpcResponse {
	result?: unknown;
	error?: { code: number; message: string };
}

/**
 * Read a JSON-RPC response out of a body that may be plain JSON or a
 * server-sent event stream, depending on which framing the server picked.
 *
 * @param body The response body.
 * @returns The response, or undefined when the body carried none.
 */
function parseResponse(body: string): JsonRpcResponse | undefined {
	const trimmed = body.trim();
	if (!trimmed) {
		return undefined;
	}
	if (trimmed.startsWith('{')) {
		return JSON.parse(trimmed);
	}
	for (const line of trimmed.split('\n')) {
		if (!line.startsWith('data:')) {
			continue;
		}
		const message = JSON.parse(line.slice('data:'.length).trim()) as JsonRpcResponse;
		if (message.result !== undefined || message.error !== undefined) {
			return message;
		}
	}
	return undefined;
}

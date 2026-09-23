/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { createInterface } from 'readline';

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
 * A minimal MCP client, standing in for a coding agent.
 *
 * Deliberately dependency-free: the protocol an agent speaks over the wire is
 * exactly what these tests need to cover, so speaking it directly keeps the
 * test honest about the contract and free of an SDK's own negotiation.
 */
abstract class McpClient {
	private _nextId = 0;

	/** @param clientName The name the server records as the agent's identity. */
	constructor(private readonly clientName: string) { }

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
		const message = await this.exchange({ jsonrpc: '2.0', id, method, params });
		if (message.error) {
			throw new Error(`MCP ${method} failed: ${message.error.message}`);
		}
		return message.result;
	}

	/** Send a request and wait for its response. */
	protected abstract exchange(message: JsonRpcRequest): Promise<JsonRpcResponse>;

	/** Send a notification, which has no reply. */
	protected abstract notify(method: string, params?: unknown): Promise<void>;
}

/** A client that speaks Streamable HTTP, as an agent given a URL does. */
export class McpTestClient extends McpClient {
	private _sessionId: string | undefined;

	/**
	 * @param url This window's MCP endpoint, e.g.
	 *  `http://127.0.0.1:39000/mcp/w/<workspace-id>`.
	 * @param token The bearer token Positron published for this window.
	 * @param clientName The name the server records as the agent's identity.
	 */
	constructor(
		private readonly url: string,
		private readonly token: string,
		clientName = 'positron-e2e',
	) {
		super(clientName);
	}

	protected async exchange(message: JsonRpcRequest): Promise<JsonRpcResponse> {
		const response = await this.post(message);
		const body = await response.text();
		const parsed = parseResponse(body);
		if (!parsed) {
			throw new Error(`MCP ${message.method} returned no JSON-RPC response: ${body}`);
		}
		return parsed;
	}

	protected async notify(method: string, params?: unknown): Promise<void> {
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

/**
 * A client that starts the server as a child process and speaks
 * newline-delimited JSON-RPC over its stdin and stdout, as an agent configured
 * with a command line does.
 */
export class McpStdioClient extends McpClient {
	private readonly _process: ChildProcessWithoutNullStreams;
	private readonly _pending = new Map<number, (response: JsonRpcResponse) => void>();
	private _stderr = '';

	/**
	 * @param command The executable an agent's configuration names.
	 * @param args Its arguments.
	 * @param cwd The directory the agent is working in.
	 * @param env The environment the agent hands the server.
	 * @param clientName The name the server records as the agent's identity.
	 */
	constructor(
		command: string,
		args: readonly string[],
		cwd: string,
		env: NodeJS.ProcessEnv,
		clientName = 'positron-e2e',
	) {
		super(clientName);
		this._process = spawn(command, args, { cwd, env });
		this._process.stderr.on('data', data => { this._stderr += data; });
		createInterface({ input: this._process.stdout }).on('line', line => {
			if (!line.trim()) {
				return;
			}
			const message = JSON.parse(line) as JsonRpcResponse;
			if (message.id !== undefined) {
				this._pending.get(message.id)?.(message);
				this._pending.delete(message.id);
			}
		});
	}

	protected exchange(message: JsonRpcRequest): Promise<JsonRpcResponse> {
		return new Promise((resolve, reject) => {
			this._pending.set(message.id, resolve);
			this._process.once('exit', code => reject(new Error(
				`MCP server exited with ${code} during ${message.method}: ${this._stderr}`)));
			this.write(message);
		});
	}

	protected async notify(method: string, params?: unknown): Promise<void> {
		this.write({ jsonrpc: '2.0', method, params });
	}

	/** Close stdin, which is how an agent tells the server to exit. */
	close(): void {
		this._process.stdin.end();
	}

	private write(message: object): void {
		this._process.stdin.write(`${JSON.stringify(message)}\n`);
	}
}

/** A JSON-RPC request. */
interface JsonRpcRequest {
	jsonrpc: '2.0';
	id: number;
	method: string;
	params?: unknown;
}

/** A JSON-RPC response, however the server chose to frame it. */
interface JsonRpcResponse {
	id?: number;
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
		const data = line.startsWith('data:') ? line.slice('data:'.length).trim() : '';
		// The stream opens with a priming event that carries no data.
		if (!data) {
			continue;
		}
		const message = JSON.parse(data) as JsonRpcResponse;
		if (message.result !== undefined || message.error !== undefined) {
			return message;
		}
	}
	return undefined;
}

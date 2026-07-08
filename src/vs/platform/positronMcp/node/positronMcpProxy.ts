/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Standalone stdio-to-HTTP relay registered with the Claude Code CLI as the
 * `positron` MCP server (see positronMcpClaudeCli.ts). Claude Code launches
 * it with newline-delimited JSON-RPC on stdio; each message is forwarded
 * verbatim to the Positron window's MCP server named by the
 * `POSITRON_MCP_URL` / `POSITRON_MCP_TOKEN` environment variables, which
 * Positron injects into its integrated terminals while the server runs.
 *
 * When those variables are absent (Claude Code running outside a Positron
 * terminal, or with the MCP server disabled), the proxy answers the protocol
 * handshake itself and reports zero tools, so the registration is invisible
 * rather than broken.
 *
 * This file is copied out of the application at registration time and run by
 * plain Node (Positron's own binary under ELECTRON_RUN_AS_NODE), so it MUST
 * stay dependency-free: no `vs/*` imports, only globals available in Node 18+.
 * The compiled output is self-contained because nothing here imports anything.
 */

interface IJsonRpcMessage {
	jsonrpc: '2.0';
	id?: number | string | null;
	method?: string;
	params?: unknown;
	result?: unknown;
	error?: { code: number; message: string };
}

/** The transport seams injected by tests; production uses the real ones. */
export interface IProxyIo {
	fetch: typeof fetch;
	write: (line: string) => void;
}

export interface IProxyEndpoint {
	url: string;
	token: string;
}

/**
 * One proxy run: routes each incoming stdin line either to the Positron
 * server (endpoint known) or to the built-in disconnected responder.
 * Messages are processed strictly sequentially -- the MCP session id arrives
 * on the `initialize` response and must be captured before any later request
 * is sent.
 */
export class PositronMcpProxy {
	private _sessionId: string | undefined;
	private _queue: Promise<void> = Promise.resolve();

	constructor(
		private readonly _endpoint: IProxyEndpoint | undefined,
		private readonly _io: IProxyIo,
	) { }

	/** Queue one newline-delimited stdin chunk's worth of messages. */
	handleInput(chunk: string): Promise<void> {
		for (const line of chunk.split('\n')) {
			const trimmed = line.trim();
			if (!trimmed) {
				continue;
			}
			this._queue = this._queue.then(() => this._handleLine(trimmed));
		}
		return this._queue;
	}

	/** Best-effort session teardown for when stdin closes. */
	async end(): Promise<void> {
		await this._queue.catch(() => { });
		if (this._endpoint && this._sessionId) {
			await this._io.fetch(this._endpoint.url, {
				method: 'DELETE',
				headers: this._headers(),
			}).catch(() => { });
		}
	}

	private async _handleLine(line: string): Promise<void> {
		let message: IJsonRpcMessage;
		try {
			message = JSON.parse(line);
		} catch {
			// Not JSON: nothing useful can be answered (no id to address).
			return;
		}
		if (this._endpoint) {
			await this._forward(message);
		} else {
			this._answerDisconnected(message);
		}
	}

	private async _forward(message: IJsonRpcMessage): Promise<void> {
		try {
			const response = await this._io.fetch(this._endpoint!.url, {
				method: 'POST',
				headers: {
					...this._headers(),
					'content-type': 'application/json',
					'accept': 'application/json',
				},
				body: JSON.stringify(message),
			});
			const sessionId = response.headers.get('mcp-session-id');
			if (sessionId) {
				this._sessionId = sessionId;
			}
			const body = await response.text();
			if (response.ok && body) {
				this._io.write(body);
			} else if (!response.ok && message.id !== undefined && message.id !== null) {
				this._respondError(message.id, `Positron MCP server returned HTTP ${response.status}`);
			}
		} catch (error) {
			if (message.id !== undefined && message.id !== null) {
				this._respondError(message.id, `Positron MCP server unreachable (${error instanceof Error ? error.message : String(error)}). The Positron window that started this terminal may have closed.`);
			}
		}
	}

	/**
	 * Minimal MCP server for when no Positron endpoint is in the environment:
	 * a valid handshake and an empty tool list keep Claude Code's `positron`
	 * entry healthy-but-empty instead of erroring.
	 */
	private _answerDisconnected(message: IJsonRpcMessage): void {
		if (message.id === undefined || message.id === null || !message.method) {
			return; // Notifications and responses need no answer.
		}
		switch (message.method) {
			case 'initialize': {
				const requested = (message.params as { protocolVersion?: string } | undefined)?.protocolVersion;
				this._respondResult(message.id, {
					protocolVersion: requested ?? '2025-06-18',
					capabilities: { tools: {} },
					serverInfo: { name: 'positron-mcp-proxy', version: '1.0.0' },
					instructions: 'Positron is not reachable from this session. Positron exposes its tools only to agents launched from a Positron integrated terminal while its MCP server is enabled.',
				});
				break;
			}
			case 'tools/list':
				this._respondResult(message.id, { tools: [] });
				break;
			case 'ping':
				this._respondResult(message.id, {});
				break;
			default:
				this._io.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Method not available: ${message.method}` } }));
		}
	}

	private _headers(): Record<string, string> {
		return {
			'authorization': `Bearer ${this._endpoint!.token}`,
			...(this._sessionId ? { 'mcp-session-id': this._sessionId } : {}),
		};
	}

	private _respondResult(id: number | string, result: unknown): void {
		this._io.write(JSON.stringify({ jsonrpc: '2.0', id, result }));
	}

	private _respondError(id: number | string, message: string): void {
		this._io.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32603, message } }));
	}
}

function main(): void {
	const url = process.env['POSITRON_MCP_URL'];
	const token = process.env['POSITRON_MCP_TOKEN'];
	const endpoint = url && token ? { url, token } : undefined;
	const proxy = new PositronMcpProxy(endpoint, {
		fetch,
		write: line => process.stdout.write(line + '\n'),
	});
	process.stdin.setEncoding('utf8');
	let pending = '';
	process.stdin.on('data', (chunk: string) => {
		pending += chunk;
		const cut = pending.lastIndexOf('\n');
		if (cut === -1) {
			return;
		}
		const lines = pending.slice(0, cut + 1);
		pending = pending.slice(cut + 1);
		proxy.handleInput(lines);
	});
	process.stdin.on('end', () => {
		proxy.handleInput(pending).then(() => proxy.end()).then(() => process.exit(0));
	});
}

// Run only when executed as a script (not when imported by tests). argv[1] is
// the script path for `node <file>`; guarded so importing this module never
// touches stdio.
const scriptName = process.argv[1]?.replace(/\\/g, '/').split('/').pop();
if (scriptName && import.meta.url.endsWith('/' + scriptName)) {
	main();
}

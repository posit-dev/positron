/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import WebSocket from 'ws';

import { createWebSocket } from './NamedPipeHttpAgent';
import { budgetCommandResult } from './mcpCommandResult';
import { summarizeError } from './util';

/** The console history setting the supervisor reports to agents. */
const HISTORY_API_ENABLED_KEY = 'console.historyApiEnabled';

/** How long to wait before the first reconnect attempt. */
const RECONNECT_DELAY_MS = 1000;

/** The longest we back off between reconnect attempts. */
const MAX_RECONNECT_DELAY_MS = 30_000;

/** How long to coalesce catalog refreshes triggered by extension changes. */
const CATALOG_REFRESH_DEBOUNCE_MS = 500;

/**
 * One argument of a Positron command, as the supervisor's MCP server publishes
 * it. Mirrors `AgentCommandArg` in `kcshared::mcp_frontend`.
 */
interface ChannelCommandArg {
	name: string;
	description?: string;
	required: boolean;
	schema?: object;
}

/** A Positron command agents may run. Mirrors `AgentCommand` in `kcshared`. */
interface ChannelCommand {
	id: string;
	description: string;
	args: ChannelCommandArg[];
	returns?: string;
}

/**
 * A request from the supervisor to run a Positron command on an agent's behalf.
 * Mirrors `CommandRequest` in `kcshared::mcp_frontend`.
 */
interface CommandRequest {
	kind: 'command_request';
	id: string;
	command_id: string;
	args: unknown[];
	agent: { name?: string; version?: string };
	deadline_ms: number;
}

/** Messages the supervisor sends over the channel. */
type ServerFrontendMessage = CommandRequest;

/**
 * Connects this window to the supervisor's MCP server over a WebSocket,
 * publishing what only Positron knows -- its command catalog and its foreground
 * session -- and running the commands agents ask for.
 *
 * The channel is not required for the supervisor's kernel tools, which work
 * whether or not a window is connected. It is required for the command tools,
 * so it reconnects on its own until disposed.
 */
export class McpFrontendChannel implements vscode.Disposable {
	private _socket: WebSocket | undefined;

	/** Cleared on dispose so a pending reconnect does not resurrect us. */
	private _disposed = false;

	/** The delay before the next reconnect attempt; grows on each failure. */
	private _reconnectDelayMs = RECONNECT_DELAY_MS;

	private _reconnectTimer: NodeJS.Timeout | undefined;

	private _catalogRefreshTimer: NodeJS.Timeout | undefined;

	private readonly _disposables: vscode.Disposable[] = [];

	/**
	 * @param _uri The WebSocket URI of this frontend's channel.
	 * @param _headers Headers carrying the supervisor API bearer token.
	 * @param _log Writes a line to the Kernel Supervisor output channel.
	 */
	constructor(
		private readonly _uri: string,
		private readonly _headers: { [key: string]: string },
		private readonly _log: (message: string) => void,
	) {
		this._disposables.push(positron.runtime.onDidChangeForegroundSession(sessionId => {
			this.send({ kind: 'foreground_changed', session_id: sessionId });
		}));

		// The catalog grows and shrinks with the installed extensions, since
		// extensions contribute agent-compatible commands. Re-read it when the
		// extension set changes, coalescing the burst of events an install
		// produces.
		this._disposables.push(vscode.extensions.onDidChange(() => {
			this.scheduleCatalogRefresh();
		}));

		this.connect();
	}

	public dispose() {
		this._disposed = true;
		if (this._reconnectTimer) {
			clearTimeout(this._reconnectTimer);
			this._reconnectTimer = undefined;
		}
		if (this._catalogRefreshTimer) {
			clearTimeout(this._catalogRefreshTimer);
			this._catalogRefreshTimer = undefined;
		}
		this._disposables.forEach(disposable => disposable.dispose());
		this._disposables.length = 0;
		this._socket?.close();
		this._socket = undefined;
	}

	/** Open the channel, retrying with backoff until disposed. */
	private connect(): void {
		if (this._disposed) {
			return;
		}

		const socket = createWebSocket(this._uri, undefined, { headers: this._headers });
		this._socket = socket;

		socket.onopen = () => {
			this._reconnectDelayMs = RECONNECT_DELAY_MS;
			this._log('Connected to the MCP frontend channel');
			this.sayHello();
		};

		socket.onmessage = (event: WebSocket.MessageEvent) => {
			this.handleMessage(event.data.toString());
		};

		socket.onerror = (event: WebSocket.ErrorEvent) => {
			// A failure to connect is followed by a close, which schedules the
			// retry; this only records why.
			this._log(`MCP frontend channel error: ${event.message}`);
		};

		socket.onclose = () => {
			if (this._socket !== socket) {
				return;
			}
			this._socket = undefined;
			this.scheduleReconnect();
		};
	}

	/** Retry the connection after a growing delay. */
	private scheduleReconnect(): void {
		if (this._disposed || this._reconnectTimer) {
			return;
		}
		const delay = this._reconnectDelayMs;
		this._reconnectDelayMs = Math.min(delay * 2, MAX_RECONNECT_DELAY_MS);
		this._reconnectTimer = setTimeout(() => {
			this._reconnectTimer = undefined;
			this.connect();
		}, delay);
	}

	/**
	 * Announce ourselves: the command catalog, the session agents should target
	 * by default, and whether they may read console history.
	 */
	private async sayHello(): Promise<void> {
		const [commands, foreground] = await Promise.all([
			this.readCatalog(),
			positron.runtime.getForegroundSession(),
		]);
		this.send({
			kind: 'hello',
			positron_version: positron.version,
			commands,
			foreground_session_id: foreground?.metadata.sessionId,
			history_api_enabled: vscode.workspace.getConfiguration()
				.get<boolean>(HISTORY_API_ENABLED_KEY) === true,
		});
	}

	/** Re-read the catalog and push it, coalescing bursts of changes. */
	private scheduleCatalogRefresh(): void {
		if (this._catalogRefreshTimer) {
			clearTimeout(this._catalogRefreshTimer);
		}
		this._catalogRefreshTimer = setTimeout(async () => {
			this._catalogRefreshTimer = undefined;
			this.send({ kind: 'commands_changed', commands: await this.readCatalog() });
		}, CATALOG_REFRESH_DEBOUNCE_MS);
	}

	/**
	 * The commands agents may run in this window, in the shape the supervisor
	 * caches and searches.
	 *
	 * Disabled commands are included: the supervisor's cache has to stay valid
	 * while the window is away, and a command's precondition depends on UI
	 * state that changes far too often to publish. An agent that runs a
	 * currently disabled command gets a `disabled` reason back.
	 */
	private async readCatalog(): Promise<ChannelCommand[]> {
		try {
			const commands = await positron.ai.getAgentAllowedCommands({ includeDisabled: true });
			return commands.map(command => ({
				id: command.id,
				description: command.description ?? '',
				args: (command.args ?? []).map(arg => ({
					name: arg.name,
					description: arg.description,
					required: arg.required ?? true,
					schema: arg.schema,
				})),
				returns: command.returns,
			}));
		} catch (err) {
			this._log(`Failed to read the agent command catalog: ${summarizeError(err)}`);
			return [];
		}
	}

	/** Route a frame from the supervisor. */
	private handleMessage(text: string): void {
		let message: ServerFrontendMessage;
		try {
			message = JSON.parse(text);
		} catch (err) {
			this._log(`Unreadable frame on the MCP frontend channel: ${summarizeError(err)}`);
			return;
		}
		switch (message.kind) {
			case 'command_request':
				this.runCommand(message);
				break;
			default:
				// A newer supervisor may send frames we don't know; ignore them
				// rather than dropping the channel.
				break;
		}
	}

	/**
	 * Run a Positron command on an agent's behalf and report the outcome.
	 *
	 * Failures are answered, never thrown: the supervisor is holding an agent's
	 * tool call open waiting for this reply.
	 */
	private async runCommand(request: CommandRequest): Promise<void> {
		const agent = request.agent.name ?? 'unknown agent';
		const started = Date.now();
		try {
			const result = await positron.ai.validateAndExecuteCommand(
				request.command_id, request.args);
			const elapsed = Date.now() - started;
			if (result.ok) {
				this._log(
					`MCP command '${request.command_id}' for ${agent} succeeded in ${elapsed}ms`);
				this.send({
					kind: 'command_reply',
					id: request.id,
					ok: true,
					result: budgetCommandResult(result.result),
				});
			} else {
				this._log(`MCP command '${request.command_id}' for ${agent} failed in ` +
					`${elapsed}ms: ${result.reason}`);
				// `precondition` is a raw context-key expression; it would tell
				// an agent nothing it can act on, so it is not passed along.
				this.send({
					kind: 'command_reply',
					id: request.id,
					ok: false,
					reason: result.reason,
					message: result.message,
				});
			}
		} catch (err) {
			const message = summarizeError(err);
			this._log(`MCP command '${request.command_id}' for ${agent} threw: ${message}`);
			this.send({
				kind: 'command_reply',
				id: request.id,
				ok: false,
				reason: 'error',
				message,
			});
		}
	}

	/** Send a frame, dropping it when the channel is not open. */
	private send(message: object): void {
		if (this._socket?.readyState !== WebSocket.OPEN) {
			return;
		}
		this._socket.send(JSON.stringify(message));
	}
}

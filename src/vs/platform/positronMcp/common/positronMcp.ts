/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { McpAuditEvent, McpAuditLogDetail } from './positronMcpAudit.js';

export const IPositronMcpService = createDecorator<IPositronMcpService>('positronMcpService');

/** The default localhost port the MCP server listens on. */
export const POSITRON_MCP_DEFAULT_PORT = 43123;

/** Name of the main-process channel exposing {@link IPositronMcpService} to renderers. */
export const PositronMcpChannelName = 'positronMcp';

/**
 * Id of the log output channel the main-process server writes to. Shared so the
 * renderer's "Show Logs" action reveals the same channel the server logs into.
 */
export const POSITRON_MCP_LOG_ID = 'positronMcp';

/**
 * Name of the renderer-registered channel the main-process server calls back
 * into to invoke a window's MCP tools. The server picks the destination window
 * by matching the IPC client context, so tool calls run in the renderer where
 * the runtime/notebook/editor services live.
 */
export const PositronMcpToolBrokerChannelName = 'positronMcpToolBroker';

/**
 * Who is asking: the identity of the MCP session behind a tool call, threaded
 * from the main-process server through the broker into the renderer so consent
 * dialogs, attribution, and logs can name the agent instead of a generic "AI".
 */
export interface IMcpCallerContext {
	/** The MCP session id the call arrived on. */
	readonly mcpSessionId: string;
	/** Name the client reported at `initialize` (e.g. "claude-code"), if any. */
	readonly clientName?: string;
	/** Version the client reported at `initialize`, if any. */
	readonly clientVersion?: string;
}

/**
 * Human-readable name for a client's `clientInfo.name`, for dialog and UI copy
 * ("Claude Code wants to run..."). Unknown names pass through unchanged.
 */
export function mcpClientDisplayName(clientName: string): string {
	switch (clientName) {
		case 'claude-code': return 'Claude Code';
		case 'codex-mcp-client': return 'Codex';
		case 'gemini-cli-mcp-client': return 'Gemini CLI';
		case 'cursor-vscode': return 'Cursor';
		default: return clientName;
	}
}

/** One live MCP session, as surfaced in the status UI. */
export interface IMcpSessionInfo {
	/** The session id clients echo back in the Mcp-Session-Id header. */
	readonly sessionId: string;
	/** Name the client reported at `initialize` (e.g. "claude-code"), if any. */
	readonly clientName?: string;
	/** Version the client reported at `initialize`, if any. */
	readonly clientVersion?: string;
	/** Epoch milliseconds the session was created (the client's `initialize`). */
	readonly createdAt: number;
	/** Epoch milliseconds of the session's most recent request. */
	readonly lastActivityAt: number;
	/** Id of the window the session's tool calls run in, if one was resolved. */
	readonly pinnedWindowId?: number;
}

/** A snapshot of the server's runtime state, for status UI. */
export interface IPositronMcpServerStatus {
	/** Whether the HTTP server is currently listening. */
	readonly running: boolean;
	/** The port the server listens on (or would, when started). */
	readonly port: number;
	/**
	 * The per-user bearer token requests must carry. A local secret: the
	 * renderer needs it to write `.mcp.json` entries and render connect
	 * snippets, so it travels in the status rather than a separate getter.
	 * Stable for the process lifetime.
	 */
	readonly token: string;
	/** The live MCP sessions, oldest first. Empty when the server is stopped. */
	readonly sessions: IMcpSessionInfo[];
	/**
	 * Recent audit events (completed tool calls + session lifecycle), oldest
	 * first, capped server-side. Survives a server stop.
	 */
	readonly recentActivity: readonly McpAuditEvent[];
	/**
	 * Filesystem path of the JSONL audit file, once something has been written
	 * to it this Positron session; absent while no file exists (no MCP activity
	 * yet, or the audit detail is 'off').
	 */
	readonly auditLogPath?: string;
}

/**
 * Main-process service that owns the Positron MCP HTTP server.
 *
 * The server is a single long-lived listener on a fixed localhost port, shared
 * across all windows. Per-request routing to a specific window's renderer (where
 * the tools actually run) is handled internally via the tool-broker channel.
 *
 * The renderer drives the lifecycle (`start`/`stop`) because the enable flag is
 * a workbench setting the main process does not read directly.
 */
export interface IPositronMcpService {
	readonly _serviceBrand: undefined;

	/**
	 * Fires for every audit event, including transient `tool-call-start` events
	 * that never reach {@link IPositronMcpServerStatus.recentActivity}. Bridged
	 * to renderers automatically by the ProxyChannel.
	 */
	readonly onDidRecordActivity: Event<McpAuditEvent>;

	/** Start the HTTP server if it is not already listening. Idempotent. */
	start(): Promise<void>;

	/** Stop the HTTP server if it is listening. Idempotent. */
	stop(): Promise<void>;

	/**
	 * Adopt the renderer's `positron.mcp.auditLog.detail` value for the JSONL
	 * audit-file sink. Pushed by the lifecycle contribution because the main
	 * process cannot read workbench settings.
	 */
	setAuditLogDetail(detail: McpAuditLogDetail): Promise<void>;

	/** Current server status. */
	getStatus(): Promise<IPositronMcpServerStatus>;
}

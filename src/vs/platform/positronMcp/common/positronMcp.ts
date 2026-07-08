/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { AddFirstParameterToFunctions } from '../../../base/common/types.js';
import { Event } from '../../../base/common/event.js';
import { localize } from '../../../nls.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { McpAuditEvent, McpAuditLogDetail, McpCompletedAuditEvent } from './positronMcpAudit.js';
import { IMcpUserContextData, IMcpUserContextQuery, McpContextEventInput } from './positronMcpContext.js';

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

/**
 * The one UI label for a session's or event's client identity: the mapped
 * display name plus version, or -- for a client that never identified itself
 * (e.g. a session resumed from a stale id) -- the anonymous fallback, matching
 * the console's attribution label for unidentified agents. Every surface
 * (activity pane, status modal, status bar) renders clients through this so
 * the same agent never appears under different names.
 */
export function mcpClientLabel(clientName?: string, clientVersion?: string): string {
	if (!clientName) {
		return localize('positron.mcp.externalAgent', "External Agent");
	}
	const name = mcpClientDisplayName(clientName);
	return clientVersion ? `${name} ${clientVersion}` : name;
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
	/** Id of the window this session's tool calls run in. */
	readonly pinnedWindowId: number;
}

/**
 * A snapshot of one window's own MCP server, for status UI (the status bar dot
 * and the `.mcp.json`/connect-snippet writer, both meaningfully scoped to a
 * single window). `windowId` is injected transparently by the consuming
 * service wrapper, not passed explicitly by callers -- see
 * {@link IPositronMcpService}.
 */
export interface IPositronMcpWindowStatus {
	/** Whether this window's HTTP server is currently listening. */
	readonly running: boolean;
	/** The port this window's server listens on (0 when not started). */
	readonly port: number;
	/**
	 * The per-user bearer token requests must carry. A local secret, shared
	 * across every window: the renderer needs it to write `.mcp.json` entries
	 * and render connect snippets, so it travels in the status rather than a
	 * separate getter. Stable for the process lifetime.
	 */
	readonly token: string;
	/** This window's live MCP sessions, oldest first. Empty when stopped. */
	readonly sessions: IMcpSessionInfo[];
	/**
	 * Filesystem path of the JSONL audit file, once something has been written
	 * to it this Positron session; absent while no file exists (no MCP activity
	 * yet, or the audit detail is 'off'). Shared across every window.
	 */
	readonly auditLogPath?: string;
}

/**
 * The subset of {@link IPositronMcpWindowStatus} one {@link PositronMcpWindowServer}
 * instance actually owns -- everything else (`token`, `auditLogPath`) is
 * shared state the registry merges in. Kept separate so a window server never
 * has to fake fields it doesn't own.
 */
export type IPositronMcpWindowOwnStatus = Omit<IPositronMcpWindowStatus, 'token' | 'auditLogPath'>;

/** Whether Positron has registered a Claude Code CLI stdio proxy at user scope. */
export type ClaudeCliRegistrationState = 'registered' | 'not-found' | 'error' | 'unknown';

/**
 * A snapshot across every window's MCP sessions, for status UI that is
 * explicitly cross-window by design (the Activity pane, the Connections table).
 */
export interface IPositronMcpAggregateStatus {
	/** The per-user bearer token; see {@link IPositronMcpWindowStatus.token}. */
	readonly token: string;
	/** Live MCP sessions across every window, oldest first. */
	readonly sessions: IMcpSessionInfo[];
	/**
	 * Recent audit events (completed tool calls + session lifecycle) across
	 * every window, oldest first, capped server-side. Survives a window's
	 * server stopping.
	 */
	readonly recentActivity: readonly McpCompletedAuditEvent[];
	/** See {@link IPositronMcpWindowStatus.auditLogPath}. */
	readonly auditLogPath?: string;
	/** Whether the Claude Code CLI auto-registration succeeded. */
	readonly claudeCliState: ClaudeCliRegistrationState;
}

/**
 * Main-process service that owns the Positron MCP HTTP servers.
 *
 * Each window gets its own HTTP listener on its own OS-assigned localhost
 * port -- a terminal spawned from a window can be told, unambiguously, which
 * server is "its own", rather than every window sharing one server and
 * guessing which window a request is for. Per-request routing to the
 * renderer where the tools actually run is handled internally via the
 * tool-broker channel.
 *
 * Every method here is implicitly scoped to the calling window: the consuming
 * service wrapper injects the caller's window id as IPC context (mirroring
 * {@link INativeHostService}), so callers never pass a windowId explicitly.
 *
 * The renderer drives the lifecycle (`start`/`stop`) because the enable flag is
 * a workbench setting the main process does not read directly.
 */
export interface IPositronMcpService {
	readonly _serviceBrand: undefined;

	/**
	 * Fires for every audit event, including transient `tool-call-start` events
	 * that never reach {@link IPositronMcpAggregateStatus.recentActivity}.
	 * Bridged to renderers automatically by the ProxyChannel. Fires globally
	 * (not scoped to the calling window), since it feeds the aggregate views.
	 */
	readonly onDidRecordActivity: Event<McpAuditEvent>;

	/** Start this window's HTTP server if it is not already listening. Idempotent. */
	start(): Promise<void>;

	/** Stop this window's HTTP server if it is listening. Idempotent. */
	stop(): Promise<void>;

	/**
	 * Adopt the renderer's `positron.mcp.auditLog.detail` value for the JSONL
	 * audit-file sink. Pushed by the lifecycle contribution because the main
	 * process cannot read workbench settings.
	 */
	setAuditLogDetail(detail: McpAuditLogDetail): Promise<void>;

	/** This window's own server status. */
	getStatus(): Promise<IPositronMcpWindowStatus>;

	/** Status aggregated across every window's server, for cross-window UI. */
	getAggregateStatus(): Promise<IPositronMcpAggregateStatus>;

	/**
	 * Record one user-activity event in the context ledger. Called by each
	 * window's context observer (console executions, editor/selection changes,
	 * notebook open/close, foreground session changes -- a fixed, bounded set).
	 * The ledger assigns the event its sequence number.
	 */
	recordContextEvent(event: McpContextEventInput): Promise<void>;

	/**
	 * Answer a get-user-context query from the ledger, scoped to the calling
	 * window and attribution (its own events and the user's, never another
	 * client's). Called by the renderer tool handler.
	 */
	queryUserContext(query: IMcpUserContextQuery): Promise<IMcpUserContextData>;

	/**
	 * Ensure the Claude Code CLI has a user-scope stdio-proxy registration for
	 * Positron, so `claude` sees Positron's tools from any terminal without a
	 * project-level `.mcp.json`. Cached per main-process run; call again after
	 * installing the CLI to retry.
	 */
	ensureClaudeCliRegistered(): Promise<ClaudeCliRegistrationState>;
}

/**
 * The main-process shape of {@link IPositronMcpService}: every method gains an
 * explicit leading `windowId` parameter, since the registry serves every
 * window's own server from one instance and has no other way to know which
 * window is calling. Mirrors {@link INativeHostMainService}, which does the
 * same for {@link INativeHostService}. The consuming renderer-side service
 * wrapper supplies the id transparently via `ProxyChannel.toService`'s
 * `context` option, so callers on the {@link IPositronMcpService} side never
 * pass it explicitly.
 */
export interface IPositronMcpMainService extends AddFirstParameterToFunctions<IPositronMcpService, Promise<unknown>, number> { }

export const IPositronMcpMainService = createDecorator<IPositronMcpMainService>('positronMcpMainService');

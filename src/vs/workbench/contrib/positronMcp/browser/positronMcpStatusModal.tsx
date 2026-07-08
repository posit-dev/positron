/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronMcpStatusModal.css';

// React.
import { useEffect, useState } from 'react';

// Other dependencies.
import { getActiveWindow } from '../../../../base/browser/dom.js';
import { localize } from '../../../../nls.js';
import { Button } from '../../../../base/browser/ui/positronComponents/button/button.js';
import { PositronModalReactRenderer } from '../../../../base/browser/positronModalReactRenderer.js';
import { PositronModalDialog } from '../../../browser/positronComponents/positronModalDialog/positronModalDialog.js';
import { ClaudeCliRegistrationState, IMcpSessionInfo, mcpClientLabel } from '../../../../platform/positronMcp/common/positronMcp.js';
import { IMcpToolCallAuditEvent, McpCompletedAuditEvent } from '../../../../platform/positronMcp/common/positronMcpAudit.js';
import { WorkspaceConfigState, bearerHeader, serverUrl } from './positronMcpWorkspace.js';

/** The live status the panel renders. Computed by the command and polled while open. */
export interface IMcpStatusData {
	/** Whether `positron.mcp.enable` is set. */
	readonly enabled: boolean;
	/** Whether the HTTP server is currently listening. */
	readonly running: boolean;
	/** The port the server listens on (or would, when started). */
	readonly port: number;
	/** The bearer token clients must send, embedded in configs and snippets. */
	readonly token: string;
	/** The state of the first workspace folder's `.mcp.json` positron entry. */
	readonly workspaceConfig: WorkspaceConfigState;
	/** The live MCP sessions across every window, oldest first. */
	readonly sessions: IMcpSessionInfo[];
	/** Recent audit events (completed tool calls + lifecycle), oldest first. */
	readonly recentActivity: readonly McpCompletedAuditEvent[];
	/** Whether the user has allowed all agent code execution for this session. */
	readonly allowAllConsent: boolean;
	/** Path of the JSONL audit file, once one exists for this Positron session. */
	readonly auditLogPath?: string;
	/** Whether the Claude Code CLI auto-registration succeeded. */
	readonly claudeCliState: ClaudeCliRegistrationState;
}

/** The actions the panel triggers; the host runs the matching command and reports back. */
export type McpPanelAction =
	{ readonly id: 'enable' | 'disable' | 'addConfig' | 'showLogs' | 'openAuditLog' | 'resetConsent' };

/** The MCP clients the connect card offers setup snippets for. */
export type McpClientId = 'claude-code' | 'codex' | 'gemini-cli' | 'cursor' | 'vscode';

/** The connect-card client picker entries, in display order. */
export const MCP_CLIENTS: { readonly id: McpClientId; readonly label: string }[] = [
	{ id: 'claude-code', label: 'Claude Code' },
	{ id: 'codex', label: 'Codex CLI' },
	{ id: 'gemini-cli', label: 'Gemini CLI' },
	{ id: 'cursor', label: 'Cursor' },
	{ id: 'vscode', label: 'VS Code' },
];

/**
 * The copyable setup snippet for a client: a one-liner for CLIs with an `mcp add`
 * command, or the config stanza for file-configured clients. Syntaxes follow each
 * client's documented HTTP-transport configuration, including how each one
 * attaches the required Authorization header.
 */
export function connectSnippet(client: McpClientId, port: number, token: string): string {
	const url = serverUrl(port);
	const auth = bearerHeader(token);
	switch (client) {
		case 'claude-code':
			return `claude mcp add --transport http positron ${url} --header "Authorization: ${auth}"`;
		case 'codex':
			return `[mcp_servers.positron]\nurl = "${url}"\nhttp_headers = { Authorization = "${auth}" }`;
		case 'gemini-cli':
			return `gemini mcp add --transport http positron ${url} --header "Authorization: ${auth}"`;
		case 'cursor':
			return `{\n  "mcpServers": {\n    "positron": {\n      "url": "${url}",\n      "headers": { "Authorization": "${auth}" }\n    }\n  }\n}`;
		case 'vscode':
			return `{\n  "servers": {\n    "positron": {\n      "type": "http",\n      "url": "${url}",\n      "headers": { "Authorization": "${auth}" }\n    }\n  }\n}`;
	}
}

/** Where the snippet goes, shown above the snippet for the selected client. */
function snippetHint(client: McpClientId): string {
	switch (client) {
		case 'claude-code':
			return localize('positron.mcp.status.connect.hint.terminal', "Run in a terminal:");
		case 'codex':
			return localize('positron.mcp.status.connect.hint.codex', "Add to ~/.codex/config.toml:");
		case 'gemini-cli':
			return localize('positron.mcp.status.connect.hint.terminal', "Run in a terminal:");
		case 'cursor':
			return localize('positron.mcp.status.connect.hint.cursor', "Add to .cursor/mcp.json in your project:");
		case 'vscode':
			return localize('positron.mcp.status.connect.hint.vscode', "Add to .vscode/mcp.json in your workspace:");
	}
}

/**
 * Show the Positron MCP status panel as a modal dialog. `getStatus` supplies the
 * live state (polled while the panel is open and re-read after each action),
 * `runAction` runs the command behind a button, and `copyText` writes a connect
 * snippet to the clipboard. The command layer owns all three, keeping this
 * component free of service wiring.
 */
export function showMcpStatusModal(
	renderer: PositronModalReactRenderer,
	getStatus: () => Promise<IMcpStatusData>,
	runAction: (action: McpPanelAction) => Promise<void>,
	copyText: (text: string) => Promise<void>,
): void {
	renderer.render(
		<McpStatusPanel copyText={copyText} getStatus={getStatus} renderer={renderer} runAction={runAction} />
	);
}

interface McpStatusPanelProps {
	renderer: PositronModalReactRenderer;
	getStatus: () => Promise<IMcpStatusData>;
	runAction: (action: McpPanelAction) => Promise<void>;
	copyText: (text: string) => Promise<void>;
}

const title = localize('positron.mcp.status.title', "Positron MCP Server");

/** How often the open panel re-reads the server status. */
const REFRESH_INTERVAL_MS = 2000;

/** Format a past timestamp as a short relative label, e.g. "12s ago" / "3m ago". */
export function formatRelativeTime(atMs: number, nowMs: number = Date.now()): string {
	const seconds = Math.max(0, Math.round((nowMs - atMs) / 1000));
	if (seconds < 5) {
		return localize('positron.mcp.status.time.justNow', "just now");
	}
	if (seconds < 60) {
		return localize('positron.mcp.status.time.seconds', "{0}s ago", seconds);
	}
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) {
		return localize('positron.mcp.status.time.minutes', "{0}m ago", minutes);
	}
	const hours = Math.round(minutes / 60);
	if (hours < 24) {
		return localize('positron.mcp.status.time.hours', "{0}h ago", hours);
	}
	return localize('positron.mcp.status.time.days', "{0}d ago", Math.round(hours / 24));
}

const McpStatusPanel = (props: McpStatusPanelProps) => {
	const [status, setStatus] = useState<IMcpStatusData | undefined>(undefined);
	const [error, setError] = useState<string | undefined>(undefined);

	// Poll the status while the panel is open so connections and setup state stay
	// live without requiring a button press.
	useEffect(() => {
		let active = true;
		const refresh = () => props.getStatus().then(
			data => { if (active) { setStatus(data); setError(undefined); } },
			err => { if (active) { setError(err instanceof Error ? err.message : String(err)); } },
		);
		void refresh();
		const targetWindow = getActiveWindow();
		const interval = targetWindow.setInterval(refresh, REFRESH_INTERVAL_MS);
		return () => { active = false; targetWindow.clearInterval(interval); };
	}, [props]);

	const handleAction = async (action: McpPanelAction) => {
		try {
			await props.runAction(action);
			// Re-read status so the panel reflects the change immediately.
			setStatus(await props.getStatus());
			setError(undefined);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	};

	return (
		<PositronModalDialog
			height={540}
			renderer={props.renderer}
			title={title}
			width={560}
			onCancel={() => props.renderer.dispose()}
			onClose={() => props.renderer.dispose()}
		>
			<McpStatusContent error={error} status={status} onAction={handleAction} onCopy={props.copyText} />
		</PositronModalDialog>
	);
};

interface McpStatusContentProps {
	status: IMcpStatusData | undefined;
	error: string | undefined;
	onAction: (action: McpPanelAction) => void;
	onCopy: (text: string) => Promise<void>;
}

/**
 * The panel body: a setup checklist that collapses once complete, an allow-all
 * consent banner, the live connections table, per-client connect snippets, and
 * the always-available actions. Pure with respect to its props so it is
 * testable without the modal shell.
 */
export const McpStatusContent = (props: McpStatusContentProps) => {
	const { status, error, onAction } = props;

	const badge = !status
		? { cls: 'disabled', label: localize('positron.mcp.status.badge.loading', "Loading...") }
		: status.running
			? { cls: 'running', label: localize('positron.mcp.status.badge.running', "Running") }
			: status.enabled
				? { cls: 'restart', label: localize('positron.mcp.status.badge.restart', "Restart required") }
				: { cls: 'disabled', label: localize('positron.mcp.status.badge.disabled', "Disabled") };

	return (
		<div className='positron-mcp-status'>
			<div className='status-header'>
				<p className='subtitle'>{localize('positron.mcp.status.subtitle', "A local bridge that lets AI agents work in your live Positron session.")}</p>
				<span className={`status-badge ${badge.cls}`}><span className='badge-dot' />{badge.label}</span>
			</div>

			{status && <SetupSection status={status} onAction={onAction} />}

			{status?.allowAllConsent &&
				<div className='consent-banner'>
					<span className='codicon codicon-warning' />
					<span className='consent-text'>{localize('positron.mcp.status.consent.allowAll', "All agent code execution is allowed for this session.")}</span>
					<Button className='button row-action' onPressed={() => onAction({ id: 'resetConsent' })}>
						{localize('positron.mcp.status.consent.reset', "Reset")}
					</Button>
				</div>}

			{status?.running && <ConnectionsSection recentActivity={status.recentActivity} sessions={status.sessions} />}

			{error &&
				<p className='status-error'>{localize('positron.mcp.status.error', "Could not read server status: {0}", error)}</p>}

			{status && (status.running || status.enabled) &&
				<ConnectCard port={status.port} token={status.token} workspaceConfig={status.workspaceConfig} onCopy={props.onCopy} />}

			<div className='status-actions'>
				{status?.enabled &&
					<Button className='button action-button secondary' onPressed={() => onAction({ id: 'disable' })}>
						{localize('positron.mcp.status.action.disable', "Disable Server")}
					</Button>}
				<Button className='button action-button secondary' onPressed={() => onAction({ id: 'showLogs' })}>
					{localize('positron.mcp.status.action.showLogs', "Show Logs")}
				</Button>
				{status?.auditLogPath &&
					<Button className='button action-button secondary' onPressed={() => onAction({ id: 'openAuditLog' })}>
						{localize('positron.mcp.status.action.openAuditLog', "Open Audit Log")}
					</Button>}
			</div>
		</div>
	);
};

/** One setup-checklist row: a check state, a label, and an optional inline action. */
interface SetupRow {
	readonly key: string;
	/** done renders a check, todo an empty circle, attention a warning sign. */
	readonly state: 'done' | 'todo' | 'attention';
	readonly label: string;
	readonly action?: { readonly label: string; readonly run: () => void };
}

/**
 * The setup checklist. Each requirement renders as a checked row or an inline
 * action, so completed steps stay visible instead of buttons vanishing; when
 * everything is checked the list collapses to a single "Setup complete" line.
 */
const SetupSection = (props: { status: IMcpStatusData; onAction: (action: McpPanelAction) => void }) => {
	const { status, onAction } = props;

	const rows: SetupRow[] = [];
	rows.push(status.running
		? { key: 'server', state: 'done', label: localize('positron.mcp.status.server.running', "Server running on {0}", serverUrl(status.port)) }
		: status.enabled
			? { key: 'server', state: 'attention', label: localize('positron.mcp.status.server.restart', "Server enabled - restart Positron to start it") }
			: {
				key: 'server', state: 'todo', label: localize('positron.mcp.status.server.disabled', "Server disabled"),
				action: { label: localize('positron.mcp.status.action.enable', "Enable"), run: () => onAction({ id: 'enable' }) },
			});

	if (status.workspaceConfig === 'no-workspace') {
		rows.push({ key: 'workspace', state: 'todo', label: localize('positron.mcp.status.workspace.none', "No workspace open - open a folder to configure it") });
	} else if (status.workspaceConfig === 'configured') {
		rows.push({ key: 'workspace', state: 'done', label: localize('positron.mcp.status.workspace.configured', ".mcp.json configured") });
	} else if (status.workspaceConfig === 'stale') {
		// An entry written without (or with an old) token: the server rejects
		// its requests, so surface it as broken rather than configured.
		rows.push({
			key: 'workspace', state: 'attention', label: localize('positron.mcp.status.workspace.stale', ".mcp.json is missing the current access token"),
			action: { label: localize('positron.mcp.status.action.update', "Update"), run: () => onAction({ id: 'addConfig' }) },
		});
	} else {
		rows.push({
			key: 'workspace', state: 'todo', label: localize('positron.mcp.status.workspace.notConfigured', ".mcp.json not configured"),
			action: { label: localize('positron.mcp.status.action.add', "Add"), run: () => onAction({ id: 'addConfig' }) },
		});
	}

	if (rows.every(row => row.state === 'done')) {
		return (
			<div className='status-card setup-section'>
				<div className='setup-row'>
					<span className='setup-check done codicon codicon-pass-filled' />
					<span className='setup-text'>{localize('positron.mcp.status.setup.complete', "Setup complete")}</span>
				</div>
			</div>
		);
	}

	return (
		<div className='status-card setup-section'>
			<p className='section-title'>{localize('positron.mcp.status.setup.title', "Setup")}</p>
			{rows.map(row => (
				<div key={row.key} className='setup-row'>
					<span className={`setup-check ${row.state} codicon ${row.state === 'done' ? 'codicon-pass-filled' : row.state === 'attention' ? 'codicon-warning' : 'codicon-circle-large'}`} />
					<span className='setup-text'>{row.label}</span>
					{row.action &&
						<Button className='button row-action' onPressed={row.action.run}>{row.action.label}</Button>}
				</div>
			))}
		</div>
	);
};

/** How many recent tool calls the connections section lists. */
const RECENT_ACTIVITY_LIMIT = 10;

/**
 * The live connections table: one row per MCP session with the client identity,
 * age, and last activity. The window column appears only when the sessions span
 * more than one Positron window. Below the table, the last few tool calls from
 * the server's audit ring buffer, newest first.
 */
const ConnectionsSection = (props: { sessions: IMcpSessionInfo[]; recentActivity: readonly McpCompletedAuditEvent[] }) => {
	const { sessions, recentActivity } = props;

	const showWindow = new Set(sessions.map(s => s.pinnedWindowId)).size > 1;
	return (
		<div className='status-card connections-section'>
			<p className='section-title'>{localize('positron.mcp.status.connections.title', "Connections")}</p>
			{sessions.length === 0
				? <p className='connections-empty'>{localize('positron.mcp.status.connections.none', "No agents connected yet.")}</p>
				: <table className='connections-table'>
					<thead>
						<tr>
							<th>{localize('positron.mcp.status.connections.client', "Client")}</th>
							<th>{localize('positron.mcp.status.connections.connected', "Connected")}</th>
							<th>{localize('positron.mcp.status.connections.lastActivity', "Last activity")}</th>
							{showWindow && <th>{localize('positron.mcp.status.connections.window', "Window")}</th>}
						</tr>
					</thead>
					<tbody>
						{sessions.map(session => (
							<tr key={session.sessionId}>
								<td className='connections-client'>
									{mcpClientLabel(session.clientName, session.clientVersion)}
								</td>
								<td>{formatRelativeTime(session.createdAt)}</td>
								<td>{formatRelativeTime(session.lastActivityAt)}</td>
								{showWindow &&
									<td>{session.pinnedWindowId !== undefined
										? String(session.pinnedWindowId)
										: localize('positron.mcp.status.connections.noWindow', "none")}</td>}
							</tr>
						))}
					</tbody>
				</table>}
			<RecentActivityList recentActivity={recentActivity} />
		</div>
	);
};

/**
 * The last few completed tool calls, newest first. Lifecycle events stay in the
 * log channel; this list answers "what has the agent just been doing" at a
 * glance. Renders nothing when there is no activity yet.
 */
const RecentActivityList = (props: { recentActivity: readonly McpCompletedAuditEvent[] }) => {
	const calls = props.recentActivity
		.filter((event): event is IMcpToolCallAuditEvent => event.type === 'tool-call')
		.slice(-RECENT_ACTIVITY_LIMIT)
		.reverse();

	if (calls.length === 0) {
		return null;
	}

	return (
		<div className='activity-list'>
			<p className='section-title'>{localize('positron.mcp.status.activity.title', "Recent activity")}</p>
			{calls.map(call => (
				<div key={call.callId} className='activity-row'>
					<span className={`activity-outcome codicon ${call.outcome === 'ok' ? 'codicon-pass-filled' : 'codicon-error'}`} />
					<span className='activity-tool'>{call.toolName}</span>
					<span className='activity-client'>
						{mcpClientLabel(call.clientName, call.clientVersion)}
					</span>
					<span className='activity-meta'>
						{localize('positron.mcp.status.activity.duration', "{0}ms", call.durationMs)}
						{' - '}
						{formatRelativeTime(call.timestamp)}
					</span>
				</div>
			))}
		</div>
	);
};

/**
 * The connect card: a per-client picker showing the right setup one-liner or
 * config stanza, with a copy button.
 */
const ConnectCard = (props: { port: number; token: string; workspaceConfig: WorkspaceConfigState; onCopy: (text: string) => Promise<void> }) => {
	const [client, setClient] = useState<McpClientId>('claude-code');
	const [copied, setCopied] = useState(false);

	const snippet = connectSnippet(client, props.port, props.token);

	const handleCopy = async () => {
		await props.onCopy(snippet);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};

	return (
		<div className='connect-card'>
			<p className='connect-title'>{localize('positron.mcp.status.connect.title', "Connect a client")}</p>
			<div className='client-picker'>
				{MCP_CLIENTS.map(({ id, label }) => (
					<Button
						key={id}
						className={`button client-picker-button${id === client ? ' selected' : ''}`}
						onPressed={() => { setClient(id); setCopied(false); }}
					>
						{label}
					</Button>
				))}
			</div>
			<p className='connect-hint'>{snippetHint(client)}</p>
			<div className='connect-snippet'>
				<code className='connect-command'>{snippet}</code>
				<Button className='button row-action copy-button' onPressed={handleCopy}>
					{copied
						? localize('positron.mcp.status.connect.copied', "Copied")
						: localize('positron.mcp.status.connect.copy', "Copy")}
				</Button>
			</div>
			{client === 'claude-code' && props.workspaceConfig !== 'no-workspace' &&
				<p className='connect-hint'>{localize('positron.mcp.status.connect.altHint', "Or add .mcp.json in the setup checklist to configure this workspace automatically.")}</p>}
		</div>
	);
};

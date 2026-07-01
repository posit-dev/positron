/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronMcpStatusModal.css';

// React.
import { useEffect, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../nls.js';
import { Button } from '../../../../base/browser/ui/positronComponents/button/button.js';
import { PositronModalReactRenderer } from '../../../../base/browser/positronModalReactRenderer.js';
import { PositronModalDialog } from '../../../browser/positronComponents/positronModalDialog/positronModalDialog.js';
import { WorkspaceConfigState, serverUrl } from './positronMcpWorkspace.js';

/** The live status the panel renders. Computed by the command and refreshed on demand. */
export interface IMcpStatusData {
	/** Whether `positron.mcp.enable` is set. */
	readonly enabled: boolean;
	/** Whether the HTTP server is currently listening. */
	readonly running: boolean;
	/** The port the server listens on (or would, when started). */
	readonly port: number;
	/** Whether the first workspace folder has an `.mcp.json` with a positron entry. */
	readonly workspaceConfig: WorkspaceConfigState;
	/** Whether the agent-instruction files already carry the MCP guidance block. */
	readonly guidancePresent: boolean;
	/** Name the most recently connected client reported (e.g. "claude-code"), if any. */
	readonly lastClientName?: string;
	/** Version the most recently connected client reported, if any. */
	readonly lastClientVersion?: string;
	/** Epoch milliseconds of the most recent request from any client, if any. */
	readonly lastActivityAt?: number;
}

/** The actions the panel buttons trigger; the host runs the matching command and reports back. */
export type McpPanelAction = 'enable' | 'disable' | 'addConfig' | 'addGuidance' | 'showLogs';

/**
 * Show the Positron MCP status panel as a modal dialog. `getStatus` supplies the
 * live state (re-invoked after each action so the panel stays current), and
 * `runAction` runs the command behind a button. The command layer owns both,
 * keeping this component free of service wiring.
 */
export function showMcpStatusModal(
	renderer: PositronModalReactRenderer,
	getStatus: () => Promise<IMcpStatusData>,
	runAction: (action: McpPanelAction) => Promise<void>,
): void {
	renderer.render(
		<McpStatusPanel getStatus={getStatus} renderer={renderer} runAction={runAction} />
	);
}

interface McpStatusPanelProps {
	renderer: PositronModalReactRenderer;
	getStatus: () => Promise<IMcpStatusData>;
	runAction: (action: McpPanelAction) => Promise<void>;
}

const title = localize('positron.mcp.status.title', "Positron MCP Server");

/** Format the client name and version into one label, e.g. "claude-code 1.2.3". */
function formatClientLabel(name: string, version?: string): string {
	return version ? `${name} ${version}` : name;
}

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

	useEffect(() => {
		let active = true;
		props.getStatus().then(
			data => { if (active) { setStatus(data); setError(undefined); } },
			err => { if (active) { setError(err instanceof Error ? err.message : String(err)); } },
		);
		return () => { active = false; };
	}, [props]);

	const handleAction = async (action: McpPanelAction) => {
		try {
			await props.runAction(action);
			// Re-read status so the panel reflects the change (e.g. enabling the server).
			setStatus(await props.getStatus());
			setError(undefined);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	};

	const badge = !status
		? { cls: 'disabled', label: localize('positron.mcp.status.badge.loading', "Loading...") }
		: status.running
			? { cls: 'running', label: localize('positron.mcp.status.badge.running', "Running") }
			: status.enabled
				? { cls: 'restart', label: localize('positron.mcp.status.badge.restart', "Restart required") }
				: { cls: 'disabled', label: localize('positron.mcp.status.badge.disabled', "Disabled") };

	const serverValue = !status
		? localize('positron.mcp.status.loading', "Loading...")
		: status.running
			? localize('positron.mcp.status.server.running', "Running on {0}", serverUrl(status.port))
			: status.enabled
				? localize('positron.mcp.status.server.restart', "Enabled - restart Positron to start")
				: localize('positron.mcp.status.server.disabled', "Disabled");

	const workspaceValue = !status || status.workspaceConfig === 'no-workspace'
		? localize('positron.mcp.status.workspace.none', "No workspace open")
		: status.workspaceConfig === 'configured'
			? localize('positron.mcp.status.workspace.configured', "Configured (.mcp.json)")
			: localize('positron.mcp.status.workspace.notConfigured', "Not configured");

	const clientValue = !status || !status.running
		? localize('positron.mcp.status.client.unavailable', "Not available")
		: status.lastClientName
			? formatClientLabel(status.lastClientName, status.lastClientVersion)
			+ (status.lastActivityAt ? ` - ${formatRelativeTime(status.lastActivityAt)}` : '')
			: localize('positron.mcp.status.client.none', "No requests yet");

	// Highlight the most useful next step: enabling when off, or configuring the
	// workspace once the server is on.
	const configIsPrimary = status?.enabled === true;

	return (
		<PositronModalDialog
			height={480}
			renderer={props.renderer}
			title={title}
			width={560}
			onCancel={() => props.renderer.dispose()}
			onClose={() => props.renderer.dispose()}
		>
			<div className='positron-mcp-status'>
				<div className='status-header'>
					<p className='subtitle'>{localize('positron.mcp.status.subtitle', "A local bridge that lets AI agents work in your live Positron session.")}</p>
					<span className={`status-badge ${badge.cls}`}><span className='badge-dot' />{badge.label}</span>
				</div>

				<div className='status-card'>
					<div className='status-row'>
						<span className='status-label'>{localize('positron.mcp.status.label.server', "Server")}</span>
						<span className='status-value'><span className={`status-dot ${badge.cls}`} />{serverValue}</span>
					</div>
					<div className='status-row'>
						<span className='status-label'>{localize('positron.mcp.status.label.workspace', "This workspace")}</span>
						<span className='status-value'>{workspaceValue}</span>
					</div>
					<div className='status-row'>
						<span className='status-label'>{localize('positron.mcp.status.label.client', "Last client")}</span>
						<span className='status-value'>{clientValue}</span>
					</div>
				</div>

				{error &&
					<p className='status-error'>{localize('positron.mcp.status.error', "Could not read server status: {0}", error)}</p>}

				<div className='status-actions'>
					{status && !status.enabled &&
						<Button className='button action-button primary' onPressed={() => handleAction('enable')}>
							{localize('positron.mcp.status.action.enable', "Enable Server")}
						</Button>}
					{status?.enabled &&
						<Button className='button action-button secondary' onPressed={() => handleAction('disable')}>
							{localize('positron.mcp.status.action.disable', "Disable Server")}
						</Button>}
					{status && status.workspaceConfig === 'not-configured' &&
						<Button className={`button action-button ${configIsPrimary ? 'primary' : 'secondary'}`} onPressed={() => handleAction('addConfig')}>
							{localize('positron.mcp.status.action.addConfig', "Add .mcp.json")}
						</Button>}
					{status && status.workspaceConfig !== 'no-workspace' && !status.guidancePresent &&
						<Button className='button action-button secondary' onPressed={() => handleAction('addGuidance')}>
							{localize('positron.mcp.status.action.addGuidance', "Add Agent Guidance")}
						</Button>}
					<Button className='button action-button secondary' onPressed={() => handleAction('showLogs')}>
						{localize('positron.mcp.status.action.showLogs', "Show Logs")}
					</Button>
				</div>

				{status && (status.running || status.enabled) &&
					<div className='connect-card'>
						<p className='connect-title'>{localize('positron.mcp.status.connect.title', "Connect a client")}</p>
						<p className='connect-hint'>{localize('positron.mcp.status.connect.hint', "Point an MCP client at this server. For Claude Code:")}</p>
						<code className='connect-command'>{`claude mcp add --transport http positron ${serverUrl(status.port)}`}</code>
						{status.workspaceConfig !== 'no-workspace' &&
							<p className='connect-hint'>{localize('positron.mcp.status.connect.altHint', "Or use \"Add .mcp.json\" above to configure this workspace automatically.")}</p>}
					</div>}
			</div>
		</PositronModalDialog>
	);
};

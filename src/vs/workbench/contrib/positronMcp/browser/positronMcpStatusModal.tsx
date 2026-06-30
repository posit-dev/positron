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

const McpStatusPanel = (props: McpStatusPanelProps) => {
	const [status, setStatus] = useState<IMcpStatusData | undefined>(undefined);

	useEffect(() => {
		let active = true;
		props.getStatus().then(data => { if (active) { setStatus(data); } });
		return () => { active = false; };
	}, [props]);

	const handleAction = async (action: McpPanelAction) => {
		await props.runAction(action);
		// Re-read status so the panel reflects the change (e.g. enabling the server).
		setStatus(await props.getStatus());
	};

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

	const serverDot = status?.running ? 'running' : status?.enabled ? 'restart' : 'disabled';

	return (
		<PositronModalDialog
			height={360}
			renderer={props.renderer}
			title={title}
			width={520}
			onCancel={() => props.renderer.dispose()}
		>
			<div className='positron-mcp-status'>
				<p className='subtitle'>{localize('positron.mcp.status.subtitle', "A local bridge that lets AI agents work in your live Positron session.")}</p>

				<div className='status-card'>
					<div className='status-row'>
						<span className='status-label'>{localize('positron.mcp.status.label.server', "Server")}</span>
						<span className='status-value'><span className={`status-dot ${serverDot}`} />{serverValue}</span>
					</div>
					<div className='status-row'>
						<span className='status-label'>{localize('positron.mcp.status.label.workspace', "This workspace")}</span>
						<span className='status-value'>{workspaceValue}</span>
					</div>
				</div>

				<div className='status-actions'>
					{status && !status.enabled &&
						<Button className='button action-button' onPressed={() => handleAction('enable')}>
							{localize('positron.mcp.status.action.enable', "Enable Server")}
						</Button>}
					{status?.enabled &&
						<Button className='button action-button' onPressed={() => handleAction('disable')}>
							{localize('positron.mcp.status.action.disable', "Disable Server")}
						</Button>}
					{status && status.workspaceConfig === 'not-configured' &&
						<Button className='button action-button' onPressed={() => handleAction('addConfig')}>
							{localize('positron.mcp.status.action.addConfig', "Add .mcp.json")}
						</Button>}
					{status && status.workspaceConfig !== 'no-workspace' &&
						<Button className='button action-button' onPressed={() => handleAction('addGuidance')}>
							{localize('positron.mcp.status.action.addGuidance', "Add Agent Guidance")}
						</Button>}
					<Button className='button action-button' onPressed={() => handleAction('showLogs')}>
						{localize('positron.mcp.status.action.showLogs', "Show Logs")}
					</Button>
				</div>

				{status && status.workspaceConfig !== 'no-workspace' &&
					<div className='connect-card'>
						<p className='connect-hint'>{localize('positron.mcp.status.connect.hint', "Point an MCP client at this server. For Claude Code:")}</p>
						<code className='connect-command'>{`claude mcp add --transport http positron ${serverUrl(status.port)}`}</code>
					</div>}
			</div>
		</PositronModalDialog>
	);
};

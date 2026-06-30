/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/** The data the control panel renders. Computed by the extension and passed in. */
export interface McpStatusData {
	/** Whether `positron.mcp.enable` is set. */
	enabled: boolean;
	/** Whether the HTTP server is currently listening in this window. */
	running: boolean;
	/** The port the server listens on (or would, when started). */
	port: number;
	/** Whether the first workspace folder has an .mcp.json with a positron entry. */
	workspaceConfig: 'configured' | 'not-configured' | 'no-workspace';
	/** Formatted last-client label (e.g. "Claude Code 1.2.3"), if any. */
	lastClient?: string;
	/** Formatted relative time of the last request (e.g. "12s ago"), if any. */
	lastActivity?: string;
}

/** Buttons in the panel post one of these back to the extension. */
type PanelCommand = 'enable' | 'disable' | 'addConfig' | 'addGuidance' | 'showLogs' | 'showAudit' | 'refresh';

/** Map a panel button to the extension command it runs. `refresh` runs nothing. */
const COMMAND_MAP: Record<Exclude<PanelCommand, 'refresh'>, string> = {
	enable: 'positron.mcp.enableServer',
	disable: 'positron.mcp.disableServer',
	addConfig: 'positron.mcp.addConfigFile',
	addGuidance: 'positron.mcp.addAgentGuidance',
	showLogs: 'positron.mcp.showLogs',
	showAudit: 'positron.mcp.showAuditLog',
};

/**
 * A webview "landing page" for the Positron MCP server: shows live status and
 * offers the same actions as the commands, styled with the editor's theme
 * variables so it matches the active theme. A single panel is reused across
 * opens. Live state is supplied by the `getStatus` callback the extension passes
 * in, keeping this module decoupled from the server internals.
 */
export class McpControlPanel {
	private static readonly viewType = 'positronMcpControlPanel';
	private static current: McpControlPanel | undefined;

	private readonly disposables: vscode.Disposable[] = [];

	static createOrShow(getStatus: () => Promise<McpStatusData>): void {
		if (McpControlPanel.current) {
			McpControlPanel.current.getStatus = getStatus;
			McpControlPanel.current.panel.reveal();
			void McpControlPanel.current.refresh();
			return;
		}
		const panel = vscode.window.createWebviewPanel(
			McpControlPanel.viewType,
			'Positron MCP',
			vscode.ViewColumn.Active,
			{ enableScripts: true, retainContextWhenHidden: true },
		);
		McpControlPanel.current = new McpControlPanel(panel, getStatus);
	}

	private constructor(
		private readonly panel: vscode.WebviewPanel,
		private getStatus: () => Promise<McpStatusData>,
	) {
		this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
		this.panel.webview.onDidReceiveMessage((message: { command?: PanelCommand }) => this.handleMessage(message), null, this.disposables);
		// Refresh when the panel becomes visible again so last-activity stays current.
		this.panel.onDidChangeViewState(e => { if (e.webviewPanel.visible) { void this.refresh(); } }, null, this.disposables);
		void this.refresh();
	}

	private async handleMessage(message: { command?: PanelCommand }): Promise<void> {
		const command = message.command;
		if (command && command !== 'refresh') {
			await vscode.commands.executeCommand(COMMAND_MAP[command]);
		}
		await this.refresh();
	}

	private async refresh(): Promise<void> {
		const data = await this.getStatus();
		this.panel.webview.html = renderControlPanelHtml(this.panel.webview, getNonce(), data);
	}

	private dispose(): void {
		McpControlPanel.current = undefined;
		this.panel.dispose();
		while (this.disposables.length) {
			this.disposables.pop()?.dispose();
		}
	}
}

function renderControlPanelHtml(webview: vscode.Webview, nonce: string, data: McpStatusData): string {
	const badge = data.running
		? { cls: 'running', label: 'Running' }
		: data.enabled
			? { cls: 'restart', label: 'Restart required' }
			: { cls: 'disabled', label: 'Disabled' };

	const serverDot = data.running ? 'dot-green' : data.enabled ? 'dot-yellow' : 'dot-gray';
	const serverValue = data.running
		? `Running on localhost:${data.port}`
		: data.enabled
			? 'Enabled - restart Positron to start'
			: 'Disabled';

	const workspaceValue = data.workspaceConfig === 'configured'
		? 'Configured (.mcp.json)'
		: data.workspaceConfig === 'not-configured'
			? 'Not configured'
			: 'No workspace open';

	const clientValue = data.lastClient
		? `${escapeHtml(data.lastClient)}${data.lastActivity ? ` - ${escapeHtml(data.lastActivity)}` : ''}`
		: data.running
			? 'No requests yet'
			: 'Not available';

	const buttons: string[] = [];
	if (!data.enabled) {
		buttons.push(button('enable', 'Enable Server', 'primary'));
	} else {
		buttons.push(button('disable', 'Disable Server', 'secondary'));
	}
	if (data.workspaceConfig === 'not-configured') {
		buttons.push(button('addConfig', 'Add .mcp.json', data.enabled ? 'primary' : 'secondary'));
	}
	if (data.workspaceConfig !== 'no-workspace') {
		buttons.push(button('addGuidance', 'Add Agent Guidance', 'secondary'));
	}
	buttons.push(button('showLogs', 'Show Logs', 'secondary'));
	buttons.push(button('showAudit', 'Security Audit Log', 'secondary'));

	const connect = data.workspaceConfig === 'no-workspace' ? '' : `
		<div class="section-title">Connect a client</div>
		<div class="card connect">
			<p class="muted">Point an MCP client at this server. For Claude Code:</p>
			<span class="connect-cmd">claude mcp add --transport http positron http://localhost:${data.port}</span>
			<p class="muted">Or use "Add .mcp.json" above to configure this workspace automatically.</p>
		</div>`;

	const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`;

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="${csp}">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<style>
		body {
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size, 13px);
			color: var(--vscode-foreground);
			background: var(--vscode-editor-background);
			margin: 0;
			padding: 36px 24px;
		}
		.page { max-width: 620px; margin: 0 auto; }
		.header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 28px; }
		.title { font-size: 22px; font-weight: 600; margin: 0; }
		.subtitle { color: var(--vscode-descriptionForeground); margin: 6px 0 0; font-size: 13px; line-height: 1.4; }
		.badge {
			display: inline-flex; align-items: center; gap: 7px;
			padding: 5px 11px; border-radius: 999px;
			font-size: 12px; font-weight: 600; white-space: nowrap;
			border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
		}
		.badge .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
		.badge.running { color: var(--vscode-charts-green, #89d185); }
		.badge.restart { color: var(--vscode-charts-yellow, #cca700); }
		.badge.disabled { color: var(--vscode-descriptionForeground); }
		.card {
			border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
			border-radius: 10px;
			padding: 2px 16px;
			margin-bottom: 8px;
			background: var(--vscode-editorWidget-background, transparent);
		}
		.row {
			display: flex; align-items: center; justify-content: space-between; gap: 16px;
			padding: 13px 0;
			border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
		}
		.row:last-child { border-bottom: none; }
		.row .label {
			color: var(--vscode-descriptionForeground);
			font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;
		}
		.row .value { display: flex; align-items: center; gap: 9px; font-weight: 500; text-align: right; }
		.dot-sm { width: 9px; height: 9px; border-radius: 50%; flex: none; }
		.dot-green { background: var(--vscode-charts-green, #89d185); }
		.dot-yellow { background: var(--vscode-charts-yellow, #cca700); }
		.dot-gray { background: var(--vscode-descriptionForeground); }
		.section-title {
			font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;
			color: var(--vscode-descriptionForeground);
			margin: 26px 0 10px;
		}
		.actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
		.btn {
			font-family: inherit; font-size: 13px;
			padding: 9px 14px; border-radius: 6px;
			border: 1px solid transparent; cursor: pointer; text-align: center;
		}
		.btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
		.btn-primary:hover { background: var(--vscode-button-hoverBackground); }
		.btn-secondary {
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
		}
		.btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
		.btn:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
		.connect { padding: 16px; }
		.connect .muted:first-child { margin-top: 0; }
		.connect .muted:last-child { margin-bottom: 0; }
		.muted { color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 1.4; }
		.connect-cmd {
			display: block; margin: 10px 0;
			padding: 10px 12px;
			background: var(--vscode-textCodeBlock-background);
			border-radius: 6px;
			font-family: var(--vscode-editor-font-family, monospace);
			font-size: 12px; overflow-x: auto; white-space: pre;
		}
	</style>
</head>
<body>
	<div class="page">
		<div class="header">
			<div>
				<h1 class="title">Positron MCP Server</h1>
				<p class="subtitle">A local bridge that lets AI agents work in your live Positron session.</p>
			</div>
			<span class="badge ${badge.cls}"><span class="dot"></span>${badge.label}</span>
		</div>

		<div class="card">
			<div class="row"><span class="label">Server</span><span class="value"><span class="dot-sm ${serverDot}"></span>${serverValue}</span></div>
			<div class="row"><span class="label">This workspace</span><span class="value">${workspaceValue}</span></div>
			<div class="row"><span class="label">Last client</span><span class="value">${clientValue}</span></div>
		</div>

		<div class="section-title">Actions</div>
		<div class="actions">${buttons.join('')}</div>
		${connect}
	</div>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		for (const el of document.querySelectorAll('[data-command]')) {
			el.addEventListener('click', () => vscode.postMessage({ command: el.getAttribute('data-command') }));
		}
	</script>
</body>
</html>`;
}

function button(command: Exclude<PanelCommand, 'refresh'>, label: string, kind: 'primary' | 'secondary'): string {
	return `<button class="btn btn-${kind}" data-command="${command}">${escapeHtml(label)}</button>`;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function getNonce(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let text = '';
	for (let i = 0; i < 32; i++) {
		text += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return text;
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { McpServer, parsePort } from './mcpServer';
import { McpControlPanel, McpStatusData } from './mcpControlPanel';
import { getLogger } from './logger';

let mcpServer: McpServer | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	// Check if MCP server is enabled via configuration
	const config = vscode.workspace.getConfiguration('positron.mcp');
	const enabled = config.get<boolean>('enable', false);

	const logger = getLogger();

	if (!enabled) {
		logger.info('Extension', 'Positron MCP server is disabled in configuration');
		// Still register commands even if server is disabled
	} else {
		try {
			logger.info('Extension', 'Initializing Positron MCP extension');

			// Create and start the MCP server
			mcpServer = new McpServer(context);
			await mcpServer.start();

			logger.info('Extension', 'Positron MCP extension activated successfully');
		} catch (error) {
			logger.error('Extension', 'Failed to start Positron MCP server', error);
			// Use Positron's modal dialog for better UX
			await positron.window.showSimpleModalDialogMessage(
				'MCP Server Error',
				`Failed to start Positron MCP server: ${error}`,
				'OK'
			);
		}
	}

	// Register command to enable MCP server
	const enableCommand = vscode.commands.registerCommand('positron.mcp.enableServer', async () => {
		try {
			await enableMcpServer();
		} catch (error) {
			const logger = getLogger();
			logger.error('Command', 'Failed to enable MCP server', error);
			await positron.window.showSimpleModalDialogMessage(
				'Failed to Enable MCP Server',
				`Failed to enable Positron MCP server: ${error}`,
				'OK'
			);
		}
	});

	// Register command to disable MCP server
	const disableCommand = vscode.commands.registerCommand('positron.mcp.disableServer', async () => {
		try {
			await disableMcpServer();
		} catch (error) {
			const logger = getLogger();
			logger.error('Command', 'Failed to disable MCP server', error);
			await positron.window.showSimpleModalDialogMessage(
				'Failed to Disable MCP Server',
				`Failed to disable Positron MCP server: ${error}`,
				'OK'
			);
		}
	});

	// Register command to add the .mcp.json file to the current workspace.
	// The server is a single global instance, but each project needs its own
	// .mcp.json pointing at it for clients (e.g. Claude Code) to discover it.
	// This writes that file directly, without re-enabling the server -- useful
	// when opening a new project while the server is already running.
	const addConfigFileCommand = vscode.commands.registerCommand('positron.mcp.addConfigFile', async () => {
		try {
			if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
				await positron.window.showSimpleModalDialogMessage(
					'No Workspace Open',
					'Open a folder or workspace first, then run this command to add the .mcp.json file to it.',
					'OK'
				);
				return;
			}

			const mcpConfigPath = await createOrUpdateMcpConfig();
			if (!mcpConfigPath) {
				await positron.window.showSimpleModalDialogMessage(
					'Failed to Add Configuration File',
					'Could not create or update the <code>.mcp.json</code> file. Check the Positron MCP logs for details.',
					'OK'
				);
				return;
			}

			let message = `An <code>.mcp.json</code> file in your workspace root now points at the Positron MCP server.`;
			const enabled = vscode.workspace.getConfiguration('positron.mcp').get<boolean>('enable', false);
			if (!enabled) {
				message += `<br><br>The MCP server is not enabled yet. Run <strong>Positron MCP: Enable Server</strong> so clients can connect.`;
			}
			await positron.window.showSimpleModalDialogMessage(
				'MCP Configuration File Added',
				message,
				'OK'
			);
		} catch (error) {
			const logger = getLogger();
			logger.error('Command', 'Failed to add .mcp.json', error);
			await positron.window.showSimpleModalDialogMessage(
				'Failed to Add Configuration File',
				`Failed to add the .mcp.json file: ${error}`,
				'OK'
			);
		}
	});

	// Register command to show logs
	const showLogsCommand = vscode.commands.registerCommand('positron.mcp.showLogs', () => {
		const logger = getLogger();
		logger.show();
	});

	// Register security-related commands
	const resetConsentCommand = vscode.commands.registerCommand('positron.mcp.resetConsent', async () => {
		if (mcpServer) {
			await mcpServer.resetSecurityConsent();
			await positron.window.showSimpleModalDialogMessage(
				'Consent Reset',
				'Code execution consent has been reset. You will be prompted again for future code execution requests.',
				'OK'
			);
		} else {
			await positron.window.showSimpleModalDialogMessage(
				'MCP Server Not Running',
				'The MCP server is not currently running. Please enable it first.',
				'OK'
			);
		}
	});

	const showAuditLogCommand = vscode.commands.registerCommand('positron.mcp.showAuditLog', async () => {
		if (mcpServer) {
			const auditLog = mcpServer.getSecurityAuditLog();
			if (auditLog.length === 0) {
				await positron.window.showSimpleModalDialogMessage(
					'Audit Log Empty',
					'The security audit log is currently empty. Actions will be logged as they occur.',
					'OK'
				);
			} else {
				// Create a webview panel to show the audit log. Scripts are
				// disabled: the audit log contains untrusted request data
				// (origins, bodies) and needs no scripting to render.
				const panel = vscode.window.createWebviewPanel(
					'mcpAuditLog',
					'MCP Security Audit Log',
					vscode.ViewColumn.One,
					{ enableScripts: false }
				);

				const htmlContent = generateAuditLogHtml(auditLog);
				panel.webview.html = htmlContent;
			}
		} else {
			await positron.window.showSimpleModalDialogMessage(
				'MCP Server Not Running',
				'The MCP server is not currently running. Please enable it first.',
				'OK'
			);
		}
	});

	const clearAuditLogCommand = vscode.commands.registerCommand('positron.mcp.clearAuditLog', async () => {
		if (mcpServer) {
			const confirmed = await positron.window.showSimpleModalDialogPrompt(
				'Clear Security Audit Log',
				'Are you sure you want to clear the security audit log? This action cannot be undone.',
				'Clear',
				'Cancel'
			);
			if (confirmed) {
				mcpServer.clearSecurityAuditLog();
				await positron.window.showSimpleModalDialogMessage(
					'Audit Log Cleared',
					'The security audit log has been cleared successfully.',
					'OK'
				);
			}
		} else {
			await positron.window.showSimpleModalDialogMessage(
				'MCP Server Not Running',
				'The MCP server is not currently running. Please enable it first.',
				'OK'
			);
		}
	});

	// Status bar item: a quick, always-visible (when enabled) indicator of MCP
	// state. Clicking it opens a modal summarizing server, workspace, and client
	// status.
	statusBarItem = vscode.window.createStatusBarItem('positron.mcp.status', vscode.StatusBarAlignment.Right, 100);
	statusBarItem.name = 'Positron MCP';
	statusBarItem.command = 'positron.mcp.showStatus';

	const showStatusCommand = vscode.commands.registerCommand('positron.mcp.showStatus', () => McpControlPanel.createOrShow(getMcpStatusData));
	const addAgentGuidanceCommand = vscode.commands.registerCommand('positron.mcp.addAgentGuidance', addAgentGuidance);

	// Keep the status bar in sync with the things that change what it reports:
	// the .mcp.json file, which folders are open, and the enable setting.
	const mcpConfigWatcher = vscode.workspace.createFileSystemWatcher('**/.mcp.json');
	mcpConfigWatcher.onDidCreate(() => updateStatusBar());
	mcpConfigWatcher.onDidChange(() => updateStatusBar());
	mcpConfigWatcher.onDidDelete(() => updateStatusBar());
	const workspaceFoldersListener = vscode.workspace.onDidChangeWorkspaceFolders(() => updateStatusBar());
	const configListener = vscode.workspace.onDidChangeConfiguration(e => {
		if (e.affectsConfiguration('positron.mcp.enable')) {
			updateStatusBar();
		}
	});

	context.subscriptions.push(
		enableCommand,
		disableCommand,
		addConfigFileCommand,
		showLogsCommand,
		resetConsentCommand,
		showAuditLogCommand,
		clearAuditLogCommand,
		statusBarItem,
		showStatusCommand,
		addAgentGuidanceCommand,
		mcpConfigWatcher,
		workspaceFoldersListener,
		configListener
	);

	await updateStatusBar();

	// Clean up server on deactivation
	context.subscriptions.push({
		dispose: () => {
			if (mcpServer) {
				const logger = getLogger();
				logger.info('Extension', 'Disposing MCP server');
				mcpServer.dispose();
				mcpServer = undefined;
			}
		}
	});
}

export function deactivate(): void {
	const logger = getLogger();
	logger.info('Extension', 'Deactivating Positron MCP extension');

	if (mcpServer) {
		mcpServer.dispose();
		mcpServer = undefined;
	}
}

async function enableMcpServer(): Promise<void> {
	const logger = getLogger();
	logger.info('Command', 'Enabling MCP server via command');

	// If the server is already running (e.g. enabled globally and started by this
	// window), there is nothing to enable -- but a newly opened project may still
	// be missing its per-workspace .mcp.json. Offer to write it instead of bailing
	// out, so this command works for new projects without a disable/re-enable cycle.
	if (mcpServer) {
		const mcpConfigPath = await offerToCreateMcpConfig();
		const message = mcpConfigPath
			? 'The Positron MCP server is already running. An <code>.mcp.json</code> file in your workspace root now points at it.'
			: 'The Positron MCP server is already running on http://localhost:43123.';
		await positron.window.showSimpleModalDialogMessage(
			'MCP Server Already Running',
			message,
			'OK'
		);
		return;
	}

	// Ask for confirmation to enable server
	const enableOptions = [
		{ label: '$(check) Yes, enable MCP server', value: true },
		{ label: '$(x) No, cancel', value: false }
	];

	const enableChoice = await vscode.window.showQuickPick(enableOptions, {
		placeHolder: 'Enable Positron MCP server?',
		title: 'MCP Server Configuration',
		ignoreFocusOut: true
	});

	if (!enableChoice || !enableChoice.value) {
		logger.info('Command', 'User cancelled MCP server enable');
		return;
	}

	// Enable the server in configuration
	const config = vscode.workspace.getConfiguration();
	await config.update('positron.mcp.enable', true, vscode.ConfigurationTarget.Global);

	// Ask about .mcp.json file configuration
	const mcpConfigPath = await offerToCreateMcpConfig();

	// Build the final message based on choices
	let message = `Positron MCP server is enabled. Please restart Positron to start the server`;

	if (mcpConfigPath) {
		message += `<br><br>An <code>.mcp.json</code> configuration file has been created/updated in your workspace root.`;
	} else {
		message += `<br><br><strong>Claude:</strong><br><br><code>claude mcp add --transport http positron http://localhost:43123</code>`;
	}

	await positron.window.showSimpleModalDialogMessage(
		'MCP Server Enabled',
		message,
		'OK'
	);
}

async function disableMcpServer(): Promise<void> {
	const logger = getLogger();
	logger.info('Command', 'Disabling MCP server via command');

	// Check if server is not running
	if (!mcpServer) {
		await positron.window.showSimpleModalDialogMessage(
			'MCP Server Not Running',
			'The Positron MCP server is already disabled.',
			'OK'
		);
		return;
	}

	// Ask for confirmation to disable server
	const disableOptions = [
		{ label: '$(check) Yes, disable MCP server', value: true },
		{ label: '$(x) No, cancel', value: false }
	];

	const disableChoice = await vscode.window.showQuickPick(disableOptions, {
		placeHolder: 'Disable Positron MCP server?',
		title: 'MCP Server Configuration',
		ignoreFocusOut: true
	});

	if (!disableChoice || !disableChoice.value) {
		logger.info('Command', 'User cancelled MCP server disable');
		return;
	}

	// Dispose of the running server
	mcpServer.dispose();
	mcpServer = undefined;

	// Disable the server in configuration
	const config = vscode.workspace.getConfiguration();
	await config.update('positron.mcp.enable', false, vscode.ConfigurationTarget.Global);

	await positron.window.showSimpleModalDialogMessage(
		'MCP Server Disabled',
		'The Positron MCP server has been disabled. The server is no longer running.',
		'OK'
	);

	logger.info('Command', 'MCP server disabled successfully');
}

/**
 * If a workspace is open, ask whether to create/update the .mcp.json file and do
 * so if the user agrees. Returns the file path on success, or undefined if there
 * is no workspace, the user skipped, or the write failed.
 */
async function offerToCreateMcpConfig(): Promise<string | undefined> {
	if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
		return undefined;
	}

	const configOptions = [
		{ label: '$(file-add) Create/update .mcp.json file', value: true },
		{ label: '$(dash) Skip configuration file', value: false }
	];

	const configChoice = await vscode.window.showQuickPick(configOptions, {
		placeHolder: 'Would you like to create or update the .mcp.json configuration file?',
		title: 'MCP Configuration File',
		ignoreFocusOut: true
	});

	if (configChoice && configChoice.value) {
		return await createOrUpdateMcpConfig();
	}
	return undefined;
}

async function createOrUpdateMcpConfig(): Promise<string | undefined> {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders || workspaceFolders.length === 0) {
		return undefined; // No workspace open
	}

	const workspaceRoot = workspaceFolders[0].uri;
	const mcpConfigPath = vscode.Uri.joinPath(workspaceRoot, '.mcp.json');

	try {
		let existingConfig: any = { mcpServers: {} };

		// Try to read existing .mcp.json
		try {
			const existingContent = await vscode.workspace.fs.readFile(mcpConfigPath);
			const contentStr = Buffer.from(existingContent).toString('utf8');
			existingConfig = JSON.parse(contentStr);
			if (!existingConfig.mcpServers) {
				existingConfig.mcpServers = {};
			}
		} catch (error) {
			// File doesn't exist or is invalid, use default config
		}

		// Add or update the Positron MCP server
		existingConfig.mcpServers.positron = {
			type: 'http',
			url: 'http://localhost:43123'
		};

		// Write the updated config
		const configContent = JSON.stringify(existingConfig, null, 2);
		await vscode.workspace.fs.writeFile(mcpConfigPath, Buffer.from(configContent, 'utf8'));

		const logger = getLogger();
		logger.info('Config', `Created/updated .mcp.json at ${mcpConfigPath.fsPath}`);
		return mcpConfigPath.fsPath;
	} catch (error) {
		const logger = getLogger();
		logger.error('Config', 'Failed to create/update .mcp.json', error);
		return undefined;
	}
}

type WorkspaceConfigState = 'configured' | 'not-configured' | 'no-workspace';

/** Whether the first workspace folder has an .mcp.json with a positron entry. */
async function getWorkspaceConfigState(): Promise<WorkspaceConfigState> {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders || folders.length === 0) {
		return 'no-workspace';
	}
	const mcpConfigPath = vscode.Uri.joinPath(folders[0].uri, '.mcp.json');
	try {
		const content = await vscode.workspace.fs.readFile(mcpConfigPath);
		const parsed = JSON.parse(Buffer.from(content).toString('utf8'));
		return parsed?.mcpServers?.positron ? 'configured' : 'not-configured';
	} catch {
		// Missing file or invalid JSON -- treat as not configured.
		return 'not-configured';
	}
}

/** Refresh the status bar item. It is hidden while the server is disabled, and
 * shows a warning background when something needs attention (server enabled but
 * not running, or this workspace lacks an .mcp.json). */
async function updateStatusBar(): Promise<void> {
	if (!statusBarItem) {
		return;
	}
	const enabled = vscode.workspace.getConfiguration('positron.mcp').get<boolean>('enable', false);
	if (!enabled) {
		statusBarItem.hide();
		return;
	}

	const running = mcpServer !== undefined;
	const configState = await getWorkspaceConfigState();
	const needsAttention = !running || configState === 'not-configured';

	statusBarItem.text = needsAttention ? '$(warning) MCP' : '$(plug) MCP';
	statusBarItem.backgroundColor = needsAttention
		? new vscode.ThemeColor('statusBarItem.warningBackground')
		: undefined;

	const serverLine = running
		? `MCP server running on localhost:${mcpServer!.getStatus().port}`
		: 'MCP server enabled (restart Positron to start)';
	const workspaceLine = configState === 'configured'
		? 'This workspace is configured (.mcp.json)'
		: configState === 'not-configured'
			? 'This workspace has no .mcp.json'
			: 'No workspace open';
	statusBarItem.tooltip = `${serverLine}\n${workspaceLine}\nClick for details`;
	statusBarItem.show();
}

/** Gather the live status the control panel renders. */
async function getMcpStatusData(): Promise<McpStatusData> {
	const enabled = vscode.workspace.getConfiguration('positron.mcp').get<boolean>('enable', false);
	const status = mcpServer?.getStatus();
	const workspaceConfig = await getWorkspaceConfigState();

	let lastClient: string | undefined;
	let lastActivity: string | undefined;
	if (status?.lastRequestAt) {
		lastActivity = formatRelativeTime(status.lastRequestAt);
		lastClient = status.lastClient
			? `${status.lastClient.name}${status.lastClient.version ? ` ${status.lastClient.version}` : ''}`
			: 'Unknown client';
	}

	return {
		enabled,
		running: status?.running ?? false,
		port: status?.port ?? parsePort(),
		workspaceConfig,
		lastClient,
		lastActivity,
	};
}

/** Format a past Date as a short relative time like "12s ago" or "3m ago". */
function formatRelativeTime(date: Date): string {
	const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
	if (seconds < 60) {
		return `${seconds}s ago`;
	}
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) {
		return `${minutes}m ago`;
	}
	const hours = Math.round(minutes / 60);
	return `${hours}h ago`;
}

// A marker comment so re-running the guidance command is idempotent: if the
// marker is already in the file, we leave it alone.
const GUIDANCE_MARKER = '<!-- positron-mcp -->';
const GUIDANCE_TEXT = 'This workspace has a Positron MCP server available. Use its `positron` MCP tools to run code, inspect variables and data, create plots, and edit notebooks in the user\'s live Positron session -- prefer them over your own shell for any data exploration or modeling work.';

/**
 * Append the Positron MCP usage note to an agent-instruction file in the first
 * workspace folder, creating the file if needed. No-op if the marker is already
 * present.
 */
async function appendAgentGuidance(fileName: string): Promise<'added' | 'present' | 'failed'> {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders || folders.length === 0) {
		return 'failed';
	}
	const uri = vscode.Uri.joinPath(folders[0].uri, fileName);
	try {
		let existing = '';
		try {
			existing = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
		} catch {
			// File does not exist yet -- it will be created.
		}
		if (existing.includes(GUIDANCE_MARKER)) {
			return 'present';
		}
		const separator = existing.length === 0 ? '' : existing.endsWith('\n') ? '\n' : '\n\n';
		const block = `${separator}${GUIDANCE_MARKER}\n${GUIDANCE_TEXT}\n`;
		await vscode.workspace.fs.writeFile(uri, Buffer.from(existing + block, 'utf8'));
		return 'added';
	} catch (error) {
		getLogger().error('Command', `Failed to update ${fileName}`, error);
		return 'failed';
	}
}

/**
 * Ask which agent-instruction file(s) to update, append the MCP usage note to
 * each, open the ones we changed, and report the outcome.
 */
async function addAgentGuidance(): Promise<void> {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders || folders.length === 0) {
		await positron.window.showSimpleModalDialogMessage(
			'No Workspace Open',
			'Open a folder or workspace first, then run this command to add MCP usage guidance.',
			'OK'
		);
		return;
	}

	const picks = await vscode.window.showQuickPick(
		[
			{ label: 'AGENTS.md', description: 'Read by Codex and many other agents' },
			{ label: 'CLAUDE.md', description: 'Read by Claude Code' },
		],
		{
			canPickMany: true,
			title: 'Add Positron MCP Guidance',
			placeHolder: 'Select the agent instruction file(s) to update',
			ignoreFocusOut: true,
		}
	);
	if (!picks || picks.length === 0) {
		return;
	}

	const results = await Promise.all(picks.map(async pick => ({ file: pick.label, status: await appendAgentGuidance(pick.label) })));

	// Open the files we actually changed so the addition is visible.
	for (const result of results) {
		if (result.status === 'added') {
			try {
				await vscode.window.showTextDocument(vscode.Uri.joinPath(folders[0].uri, result.file), { preview: false });
			} catch {
				// Opening the file is a convenience, not essential.
			}
		}
	}

	const summary = results.map(r => {
		const outcome = r.status === 'added' ? 'guidance added' : r.status === 'present' ? 'already present' : 'could not be updated';
		return `<code>${escapeHtml(r.file)}</code>: ${outcome}`;
	}).join('<br>');
	await positron.window.showSimpleModalDialogMessage('Agent Guidance', summary, 'OK');
}

function escapeHtml(value: unknown): string {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function generateAuditLogHtml(auditLog: any[]): string {
	return `
		<!DOCTYPE html>
		<html>
		<head>
			<style>
				body {
					font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
					padding: 20px;
					background: var(--vscode-editor-background);
					color: var(--vscode-editor-foreground);
				}
				h1 {
					border-bottom: 1px solid var(--vscode-panel-border);
					padding-bottom: 10px;
				}
				.entry {
					margin: 10px 0;
					padding: 10px;
					border: 1px solid var(--vscode-panel-border);
					border-radius: 4px;
					background: var(--vscode-editor-inactiveSelectionBackground);
				}
				.entry.error {
					border-color: var(--vscode-errorForeground);
				}
				.entry.security {
					border-color: var(--vscode-warningForeground);
				}
				.timestamp {
					color: var(--vscode-descriptionForeground);
					font-size: 0.9em;
				}
				.method {
					font-weight: bold;
					color: var(--vscode-symbolIcon-methodForeground);
				}
				.details {
					margin-top: 5px;
					font-family: 'Courier New', Courier, monospace;
					font-size: 0.9em;
					background: var(--vscode-textCodeBlock-background);
					padding: 5px;
					border-radius: 3px;
					white-space: pre-wrap;
				}
			</style>
		</head>
		<body>
			<h1>MCP Security Audit Log</h1>
			<div>Total entries: ${auditLog.length}</div>
			<hr>
			${auditLog.map(entry => `
				<div class="entry ${escapeHtml(entry.eventType)}">
					<div class="timestamp">${escapeHtml(entry.timestamp)}</div>
					<div>
						<span class="method">${escapeHtml(String(entry.eventType).toUpperCase())}</span>
						${entry.method ? ` - ${escapeHtml(entry.method)}` : ''}
						${entry.tool ? ` - Tool: ${escapeHtml(entry.tool)}` : ''}
						// allow-any-unicode-next-line
						${entry.success ? ' ✓' : ' ✗'}
					</div>
					${entry.origin ? `<div>Origin: ${escapeHtml(entry.origin)}</div>` : ''}
					${entry.details ? `<div class="details">${escapeHtml(JSON.stringify(entry.details, null, 2))}</div>` : ''}
				</div>
			`).join('')}
		</body>
		</html>
	`;
}

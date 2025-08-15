/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { McpServer } from './mcpServer';
import { PositronApiWrapper } from './positronApiWrapper';
import { getLogger } from './logger';

let mcpServer: McpServer | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	// Check if MCP server is enabled via configuration
	const config = vscode.workspace.getConfiguration('positron.mcp');
	const enabled = config.get<boolean>('enable', false);

	const logger = getLogger();
	
	if (!enabled) {
		logger.info('Extension', 'Positron MCP server is disabled in configuration');
		return;
	}

	try {
		logger.info('Extension', 'Initializing Positron MCP extension');
		
		// Create the API wrapper
		const apiWrapper = new PositronApiWrapper(context);

		// Create and start the MCP server with the API wrapper and context
		mcpServer = new McpServer(apiWrapper, context);
		await mcpServer.start();

		logger.info('Extension', 'Positron MCP extension activated successfully');
	} catch (error) {
		logger.error('Extension', 'Failed to start Positron MCP server', error);
		vscode.window.showErrorMessage(`Failed to start Positron MCP server: ${error}`);
	}

	// Register command to enable MCP server
	const enableCommand = vscode.commands.registerCommand('positron.mcp.enableServer', async () => {
		try {
			await enableMcpServer();
		} catch (error) {
			const logger = getLogger();
			logger.error('Command', 'Failed to enable MCP server', error);
			vscode.window.showErrorMessage(`Failed to enable Positron MCP server: ${error}`);
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
			vscode.window.showInformationMessage('Code execution consent has been reset.');
		} else {
			vscode.window.showWarningMessage('MCP server is not running.');
		}
	});

	const showAuditLogCommand = vscode.commands.registerCommand('positron.mcp.showAuditLog', () => {
		if (mcpServer) {
			const auditLog = mcpServer.getSecurityAuditLog();
			if (auditLog.length === 0) {
				vscode.window.showInformationMessage('Security audit log is empty.');
			} else {
				// Create a webview panel to show the audit log
				const panel = vscode.window.createWebviewPanel(
					'mcpAuditLog',
					'MCP Security Audit Log',
					vscode.ViewColumn.One,
					{ enableScripts: true }
				);
				
				const htmlContent = generateAuditLogHtml(auditLog);
				panel.webview.html = htmlContent;
			}
		} else {
			vscode.window.showWarningMessage('MCP server is not running.');
		}
	});

	const clearAuditLogCommand = vscode.commands.registerCommand('positron.mcp.clearAuditLog', async () => {
		if (mcpServer) {
			const answer = await vscode.window.showWarningMessage(
				'Are you sure you want to clear the security audit log?',
				'Yes',
				'No'
			);
			if (answer === 'Yes') {
				mcpServer.clearSecurityAuditLog();
				vscode.window.showInformationMessage('Security audit log has been cleared.');
			}
		} else {
			vscode.window.showWarningMessage('MCP server is not running.');
		}
	});

	context.subscriptions.push(
		enableCommand,
		showLogsCommand,
		resetConsentCommand,
		showAuditLogCommand,
		clearAuditLogCommand
	);

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
	
	const config = vscode.workspace.getConfiguration();
	await config.update('positron.mcp.enable', true, vscode.ConfigurationTarget.Global);

	// Try to create/update .mcp.json
	const mcpConfigPath = await createOrUpdateMcpConfig();

	let message = `Positron MCP server is **enabled**. Please **restart Positron**, then configure your AI tool to connect to:\n\n\`http://localhost:43123\``;

	if (mcpConfigPath) {
		message += `\n\nA \`.mcp.json\` configuration file has been created/updated in your workspace root.`;
	}

	message += `\n\n**Claude:**\n\n\`claude mcp add --transport http positron http://localhost:43123\``;

	await vscode.window.showInformationMessage(message, { modal: true }, 'OK');
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
				<div class="entry ${entry.eventType}">
					<div class="timestamp">${entry.timestamp}</div>
					<div>
						<span class="method">${entry.eventType.toUpperCase()}</span>
						${entry.method ? ` - ${entry.method}` : ''}
						${entry.tool ? ` - Tool: ${entry.tool}` : ''}
						${entry.success ? ' ✓' : ' ✗'}
					</div>
					${entry.origin ? `<div>Origin: ${entry.origin}</div>` : ''}
					${entry.details ? `<div class="details">${JSON.stringify(entry.details, null, 2)}</div>` : ''}
				</div>
			`).join('')}
		</body>
		</html>
	`;
}

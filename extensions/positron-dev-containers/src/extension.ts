/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getLogger } from './common/logger';
import { getConfiguration } from './common/configuration';
import { Workspace } from './common/workspace';
import { PortForwardingManager } from './remote/portForwarding';
import { ConnectionManager } from './remote/connectionManager';
import { DevContainerAuthorityResolver } from './remote/authorityResolver';
import { getDevContainerManager } from './container/devContainerManager';
import { RebuildStateManager } from './common/rebuildState';
import { WorkspaceMappingStorage } from './common/workspaceMappingStorage';

// Import command implementations
import * as ReopenCommands from './commands/reopen';
import * as RebuildCommands from './commands/rebuild';
import * as OpenCommands from './commands/open';
import * as AttachCommands from './commands/attach';

// Import view providers
import { DevContainersTreeProvider, DevContainerTreeItem } from './views/devContainersTreeProvider';

// Import notifications
import { checkAndShowDevContainerNotification } from './notifications/devContainerDetection';

/**
 * Extension activation
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const logger = getLogger();
	const config = getConfiguration();

	// Initialize logger
	logger.initialize(context, config.getLogLevel());
	logger.info('Activating positron-dev-containers extension');

	// Log workspace information
	const hasDevContainer = Workspace.hasDevContainer();
	const isInDevContainer = Workspace.isInDevContainer();
	logger.debug(`Has dev container: ${hasDevContainer}`);
	logger.debug(`Is in dev container: ${isInDevContainer}`);
	logger.debug(`Remote name: ${Workspace.getRemoteName() || 'none'}`);

	// Check environment variables on activation (trace level for detailed diagnostics)
	logger.trace(`LOCAL_WORKSPACE_FOLDER: ${process.env.LOCAL_WORKSPACE_FOLDER || 'NOT SET'}`);
	logger.trace(`CONTAINER_WORKSPACE_FOLDER: ${process.env.CONTAINER_WORKSPACE_FOLDER || 'NOT SET'}`);
	logger.trace(`POSITRON_CONTAINER_ID: ${process.env.POSITRON_CONTAINER_ID || 'NOT SET'}`);
	logger.trace(`POSITRON_REMOTE_ENV: ${process.env.POSITRON_REMOTE_ENV || 'NOT SET'}`);

	// --- Start Positron ---
	// Initialize workspace mapping storage FIRST (before authority resolver)
	// This must be loaded synchronously before any getCanonicalURI calls
	const workspaceMappingStorage = WorkspaceMappingStorage.initialize(context, logger);
	await workspaceMappingStorage.load();
	logger.info('Workspace mapping storage initialized');

	// Optionally clean up stale mappings (older than 30 days)
	await workspaceMappingStorage.cleanupStale();

	// Initialize core managers for Phase 4: Remote Authority Resolver

	// Create PortForwardingManager for port forwarding
	const portForwardingManager = new PortForwardingManager(logger);

	// Create ConnectionManager to manage container connections
	const connectionManager = new ConnectionManager(
		logger,
		portForwardingManager
	);

	// Create and register the authority resolver
	const authorityResolver = new DevContainerAuthorityResolver(logger, connectionManager);

	// Register resolver for dev-container and attached-container authorities
	context.subscriptions.push(
		vscode.workspace.registerRemoteAuthorityResolver('dev-container', authorityResolver)
	);
	context.subscriptions.push(
		vscode.workspace.registerRemoteAuthorityResolver('attached-container', authorityResolver)
	);

	logger.info('Remote authority resolver registered');
	// ResourceLabelFormatter is now registered dynamically in the authority resolver

	// Register tree view for dev containers (only when not in a dev container)
	let devContainersTreeProvider: DevContainersTreeProvider | undefined;
	if (!isInDevContainer) {
		devContainersTreeProvider = new DevContainersTreeProvider();
		context.subscriptions.push(
			vscode.window.registerTreeDataProvider('targetsContainers', devContainersTreeProvider)
		);
		logger.info('Dev containers tree view registered');
	} else {
		logger.info('Skipping dev containers tree view registration (running in dev container)');
	}

	// Set context key for UI visibility
	vscode.commands.executeCommand('setContext', 'isInDevContainer', isInDevContainer);

	// Cleanup on extension deactivation
	context.subscriptions.push({
		dispose: () => {
			connectionManager.dispose();
			portForwardingManager.dispose();
			authorityResolver.dispose();
		}
	});
	// --- End Positron ---

	// Register commands
	registerCommands(context, devContainersTreeProvider, connectionManager);

	// Listen for configuration changes
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('dev.containers')) {
				config.reload();

				// Update log level if it changed
				if (e.affectsConfiguration('dev.containers.logLevel')) {
					logger.setLogLevel(config.getLogLevel());
				}
			}
		})
	);

	// Check for pending rebuilds (only on host, not in container)
	// This must be done before showing the notification to avoid interrupting the rebuild
	let hasPendingRebuild = false;
	if (!isInDevContainer) {
		const rebuildState = new RebuildStateManager(context);
		hasPendingRebuild = !!rebuildState.getPendingRebuild();

		if (hasPendingRebuild) {
			logger.info('Pending rebuild detected, handling it now');
			await handlePendingRebuild(context);
		}
	}

	logger.info('positron-dev-containers extension activated successfully');

	// Show dev container detection notification after a delay (only if not rebuilding)
	// This gives the UI time to fully activate and avoids interrupting the rebuild flow
	if (!isInDevContainer && !hasPendingRebuild) {
		setTimeout(() => {
			checkAndShowDevContainerNotification(context).catch(err => {
				logger.error('Failed to show dev container notification', err);
			});
		}, 250);
	}
}

/**
 * Extension deactivation
 */
export function deactivate(): void {
	const logger = getLogger();
	logger.info('Deactivating positron-dev-containers extension');
	logger.dispose();
}

/**
 * Handle pending rebuild requests from remote sessions
 * This runs on the HOST when the extension activates after a window reload
 */
async function handlePendingRebuild(context: vscode.ExtensionContext): Promise<void> {
	const logger = getLogger();
	const rebuildState = new RebuildStateManager(context);

	const pending = rebuildState.getPendingRebuild();
	if (!pending) {
		return;
	}

	logger.info(`Found pending rebuild for: ${pending.workspaceFolder}`);

	// Clear the pending state immediately to prevent repeated attempts
	await rebuildState.clearPendingRebuild();

	try {
		// Show notification that rebuild is starting
		vscode.window.showInformationMessage(
			`Rebuilding dev container${pending.noCache ? ' (no cache)' : ''}...`
		);

		// Execute the rebuild
		const manager = getDevContainerManager();
		const result = await manager.createOrStartContainer({
			workspaceFolder: pending.workspaceFolder,
			rebuild: true,
			noCache: pending.noCache
		});

		logger.info(`Container rebuilt successfully: ${result.containerId}`);

		// Store workspace mapping BEFORE opening the window
		// This ensures the mapping is available when the authority resolver runs
		try {
			const storage = WorkspaceMappingStorage.getInstance();

			// Delete old container mapping if it exists (container ID changes on rebuild)
			if (pending.containerId && pending.containerId !== result.containerId) {
				logger.info(`Removing old container mapping: ${pending.containerId}`);
				await storage.delete(pending.containerId);
			}

			// Store new container mapping
			await storage.set(result.containerId, pending.workspaceFolder, result.remoteWorkspaceFolder);
			logger.info(`Stored workspace mapping: ${result.containerId} -> ${pending.workspaceFolder}`);
		} catch (error) {
			logger.error('Failed to store workspace mapping before window reload', error);
			// Continue anyway - but this may cause issues with the reopen
		}

		// Automatically reopen in the rebuilt container
		const authority = `dev-container+${result.containerId}`;
		const remoteUri = vscode.Uri.parse(`vscode-remote://${authority}${result.remoteWorkspaceFolder}`);

		logger.info(`Reopening in rebuilt container: ${authority}`);
		await vscode.commands.executeCommand('vscode.openFolder', remoteUri);
	} catch (error) {
		logger.error('Failed to execute pending rebuild', error);
		await vscode.window.showErrorMessage(
			`Failed to rebuild container: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

/**
 * Register all commands
 */
function registerCommands(context: vscode.ExtensionContext, devContainersTreeProvider: DevContainersTreeProvider | undefined, connectionManager: ConnectionManager): void {
	const logger = getLogger();

	// Core commands - Open/Reopen
	registerCommand(context, 'remote-containers.reopenInContainer', ReopenCommands.reopenInContainer);
	registerCommand(context, 'remote-containers.rebuildAndReopenInContainer', RebuildCommands.rebuildAndReopenInContainer);
	registerCommand(context, 'remote-containers.rebuildNoCacheAndReopenInContainer', RebuildCommands.rebuildNoCacheAndReopenInContainer);
	registerCommand(context, 'remote-containers.reopenLocally', ReopenCommands.reopenLocally);
	registerCommand(context, 'remote-containers.openFolder', OpenCommands.openFolder);
	registerCommand(context, 'remote-containers.openFolderInContainerInCurrentWindow', OpenCommands.openFolderInContainerInCurrentWindow);
	registerCommand(context, 'remote-containers.openFolderInContainerInNewWindow', OpenCommands.openFolderInContainerInNewWindow);
	registerCommand(context, 'remote-containers.openWorkspace', OpenCommands.openWorkspace);

	// Attach commands
	registerCommand(context, 'remote-containers.attachToRunningContainer', AttachCommands.attachToRunningContainer);
	registerCommand(context, 'remote-containers.attachToContainerInCurrentWindow', AttachCommands.attachToContainerInCurrentWindow);
	registerCommand(context, 'remote-containers.attachToContainerInNewWindow', AttachCommands.attachToContainerInNewWindow);

	// Container management commands
	registerCommand(context, 'remote-containers.rebuildContainer', () => RebuildCommands.rebuildContainer(context));
	registerCommand(context, 'remote-containers.rebuildContainerNoCache', () => RebuildCommands.rebuildContainerNoCache(context));
	registerCommand(context, 'remote-containers.stopContainer', AttachCommands.stopContainer);
	registerCommand(context, 'remote-containers.startContainer', AttachCommands.startContainer);
	registerCommand(context, 'remote-containers.removeContainer', AttachCommands.removeContainer);
	registerCommand(context, 'remote-containers.showContainerLog', showContainerLog);

	// Configuration commands
	registerCommand(context, 'remote-containers.openDevContainerFile', openDevContainerFile);

	// Settings and logs
	registerCommand(context, 'remote-containers.settings', openSettings);
	registerCommand(context, 'remote-containers.revealLogTerminal', revealLogTerminal);
	registerCommand(context, 'remote-containers.openLogFile', openLogFile);
	registerCommand(context, 'remote-containers.openLastLogFile', openLogFile);
	registerCommand(context, 'remote-containers.testConnection', () => testConnection(connectionManager));

	// View commands
	registerCommand(context, 'remote-containers.explorerTargetsRefresh', async () => {
		if (devContainersTreeProvider) {
			await devContainersTreeProvider.refresh();
		}
	});
}

/**
 * Helper to register a command
 */
function registerCommand(
	context: vscode.ExtensionContext,
	command: string,
	callback: (...args: any[]) => any
): void {
	context.subscriptions.push(vscode.commands.registerCommand(command, callback));
}

// --- Start Positron ---
// Command implementations (utility commands)

/**
 * Open the dev container configuration file
 */
async function openDevContainerFile(): Promise<void> {
	const logger = getLogger();
	logger.debug('Command: openDevContainerFile');

	const currentFolder = Workspace.getCurrentWorkspaceFolder();
	if (!currentFolder) {
		await vscode.window.showErrorMessage('No workspace folder is open');
		return;
	}

	// Check for .devcontainer/devcontainer.json
	let devContainerUri = vscode.Uri.joinPath(currentFolder.uri, '.devcontainer', 'devcontainer.json');

	try {
		await vscode.workspace.fs.stat(devContainerUri);
		const document = await vscode.workspace.openTextDocument(devContainerUri);
		await vscode.window.showTextDocument(document);
		return;
	} catch {
		// File doesn't exist, try next location
	}

	// Check for .devcontainer.json in workspace root
	devContainerUri = vscode.Uri.joinPath(currentFolder.uri, '.devcontainer.json');

	try {
		await vscode.workspace.fs.stat(devContainerUri);
		const document = await vscode.workspace.openTextDocument(devContainerUri);
		await vscode.window.showTextDocument(document);
		return;
	} catch {
		// File doesn't exist
	}

	await vscode.window.showErrorMessage('No dev container configuration found');
}

/**
 * Open settings
 */
async function openSettings(): Promise<void> {
	await vscode.commands.executeCommand('workbench.action.openSettings', 'dev.containers');
}

/**
 * Reveal the log terminal
 */
async function revealLogTerminal(): Promise<void> {
	getLogger().show();
}

/**
 * Open the log file
 */
async function openLogFile(): Promise<void> {
	const logger = getLogger();
	const logFilePath = logger.getLogFilePath();

	if (!logFilePath) {
		await vscode.window.showErrorMessage('No log file available');
		return;
	}

	const document = await vscode.workspace.openTextDocument(logFilePath);
	await vscode.window.showTextDocument(document);
}

/**
 * Show container log in an output channel
 */
async function showContainerLog(treeItem?: DevContainerTreeItem): Promise<void> {
	const logger = getLogger();
	logger.debug('Command: showContainerLog');

	// Type check: ensure we have a tree item with container info
	if (!treeItem || !treeItem.containerInfo) {
		await vscode.window.showErrorMessage('No container selected');
		return;
	}

	const containerInfo = treeItem.containerInfo;

	try {
		// Show progress while fetching logs
		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: `Fetching logs for ${containerInfo.containerName}...`,
				cancellable: false
			},
			async () => {
				const manager = getDevContainerManager();
				const logs = await manager.getContainerLogs(containerInfo.containerId, 1000);

				// Create or get output channel for container logs
				const outputChannel = vscode.window.createOutputChannel(
					`Container Log: ${containerInfo.containerName}`
				);

				// Clear previous logs and show new ones
				outputChannel.clear();
				outputChannel.appendLine(`Container: ${containerInfo.containerName}`);
				outputChannel.appendLine(`ID: ${containerInfo.containerId}`);
				outputChannel.appendLine(`State: ${containerInfo.state}`);
				outputChannel.appendLine('='.repeat(80));
				outputChannel.appendLine('');
				outputChannel.append(logs);

				// Show the output channel
				outputChannel.show();
			}
		);
	} catch (error) {
		logger.error('Failed to get container logs', error);
		await vscode.window.showErrorMessage(`Failed to get container logs: ${error}`);
	}
}

/**
 * Test connection to the current dev container
 */
async function testConnection(connectionManager: ConnectionManager): Promise<void> {
	const logger = getLogger();
	logger.debug('Command: testConnection');

	// Check if we're in a dev container
	if (!Workspace.isInDevContainer()) {
		await vscode.window.showInformationMessage(
			'Not currently connected to a dev container. This command is only available when running inside a dev container.'
		);
		return;
	}

	try {
		// Get container ID from workspace authority
		const currentFolder = Workspace.getCurrentWorkspaceFolder();
		if (!currentFolder || !currentFolder.uri.authority) {
			await vscode.window.showErrorMessage('Could not determine container ID from workspace');
			return;
		}

		// Extract container ID from authority (format: dev-container+<containerId> or attached-container+<containerId>)
		const authority = currentFolder.uri.authority;
		const match = authority.match(/^(?:dev-container|attached-container)\+(.+)$/);
		const containerId = match?.[1];

		if (!containerId) {
			await vscode.window.showErrorMessage(`Could not extract container ID from authority: ${authority}`);
			return;
		}

		logger.info(`Testing connection to container: ${containerId}`);

		// Get connection info
		const connection = connectionManager.getConnection(containerId);

		if (!connection) {
			await vscode.window.showWarningMessage(
				`No active connection found for container ${containerId}.\n\nThis may be normal if the connection was established in a different way.`
			);
			return;
		}

		// Build connection status message
		const stateDisplay = connection.state.charAt(0).toUpperCase() + connection.state.slice(1);

		let message = `Connection Status: ${stateDisplay}\n\n`;
		message += `Container ID: ${containerId}\n`;
		message += `Host: ${connection.host}\n`;
		message += `Port: ${connection.port}\n`;
		message += `Remote Port: ${connection.remotePort}\n`;

		if (connection.connectedAt) {
			const duration = Math.floor((Date.now() - connection.connectedAt.getTime()) / 1000);
			message += `Connected: ${duration}s ago\n`;
		}

		if (connection.localWorkspacePath && connection.remoteWorkspacePath) {
			message += `\nWorkspace Mapping:\n`;
			message += `  Local:  ${connection.localWorkspacePath}\n`;
			message += `  Remote: ${connection.remoteWorkspacePath}\n`;
		}

		if (connection.lastError) {
			message += `\nLast Error: ${connection.lastError}\n`;
		}

		// Show the connection information
		if (connection.state === 'connected') {
			await vscode.window.showInformationMessage(message, { modal: true });
		} else {
			await vscode.window.showWarningMessage(message, { modal: true });
		}

		logger.info(`Connection test completed: ${connection.state}`);

	} catch (error) {
		logger.error('Failed to test connection', error);
		await vscode.window.showErrorMessage(`Failed to test connection: ${error}`);
	}
}
// --- End Positron ---

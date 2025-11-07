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

	// --- Start Positron ---
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
	registerCommands(context, devContainersTreeProvider);

	// Listen for configuration changes
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('dev.containers')) {
				logger.debug('Dev containers configuration changed');
				config.reload();

				// Update log level if it changed
				if (e.affectsConfiguration('dev.containers.logLevel')) {
					logger.setLogLevel(config.getLogLevel());
				}
			}
		})
	);

	// Check and show dev container detection notification
	await checkAndShowDevContainerNotification(context);

	logger.info('positron-dev-containers extension activated successfully');
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
 * Register all commands
 */
function registerCommands(context: vscode.ExtensionContext, devContainersTreeProvider: DevContainersTreeProvider | undefined): void {
	const logger = getLogger();

	// Core commands - Open/Reopen
	registerCommand(context, 'remote-containers.reopenInContainer', ReopenCommands.reopenInContainer);
	registerCommand(context, 'remote-containers.rebuildAndReopenInContainer', RebuildCommands.rebuildAndReopenInContainer);
	registerCommand(context, 'remote-containers.rebuildNoCacheAndReopenInContainer', RebuildCommands.rebuildNoCacheAndReopenInContainer);
	registerCommand(context, 'remote-containers.reopenLocally', ReopenCommands.reopenLocally);
	registerCommand(context, 'remote-containers.reopenInWSL', notImplemented);
	registerCommand(context, 'remote-containers.reopenInSSH', notImplemented);
	registerCommand(context, 'remote-containers.openFolder', OpenCommands.openFolder);
	registerCommand(context, 'remote-containers.openFolderInContainerInCurrentWindow', OpenCommands.openFolderInContainerInCurrentWindow);
	registerCommand(context, 'remote-containers.openFolderInContainerInNewWindow', OpenCommands.openFolderInContainerInNewWindow);
	registerCommand(context, 'remote-containers.openWorkspace', OpenCommands.openWorkspace);

	// Attach commands
	registerCommand(context, 'remote-containers.attachToRunningContainer', notImplemented);
	registerCommand(context, 'remote-containers.attachToContainerInCurrentWindow', AttachCommands.attachToContainerInCurrentWindow);
	registerCommand(context, 'remote-containers.attachToContainerInNewWindow', AttachCommands.attachToContainerInNewWindow);

	// Container management commands
	registerCommand(context, 'remote-containers.cleanUpDevContainers', notImplemented);
	registerCommand(context, 'remote-containers.switchContainer', notImplemented);
	registerCommand(context, 'remote-containers.rebuildContainer', RebuildCommands.rebuildContainer);
	registerCommand(context, 'remote-containers.rebuildContainerNoCache', RebuildCommands.rebuildContainerNoCache);
	registerCommand(context, 'remote-containers.stopContainer', notImplemented);
	registerCommand(context, 'remote-containers.startContainer', notImplemented);
	registerCommand(context, 'remote-containers.removeContainer', AttachCommands.removeContainer);
	registerCommand(context, 'remote-containers.showContainerLog', showContainerLog);
	registerCommand(context, 'remote-containers.newContainer', notImplemented);

	// Configuration commands
	registerCommand(context, 'remote-containers.createDevContainerFile', notImplemented);
	registerCommand(context, 'remote-containers.createDevContainer', notImplemented);
	registerCommand(context, 'remote-containers.openDevContainerFile', openDevContainerFile);
	registerCommand(context, 'remote-containers.openAttachDevContainerFile', notImplemented);
	registerCommand(context, 'remote-containers.configureContainerFeatures', notImplemented);
	registerCommand(context, 'remote-containers.addExtensionToConfig', notImplemented);
	registerCommand(context, 'remote-containers.labelPortAndUpdateConfig', notImplemented);

	// Settings and logs
	registerCommand(context, 'remote-containers.settings', openSettings);
	registerCommand(context, 'remote-containers.revealLogTerminal', revealLogTerminal);
	registerCommand(context, 'remote-containers.openLogFile', openLogFile);
	registerCommand(context, 'remote-containers.openLastLogFile', openLogFile);
	registerCommand(context, 'remote-containers.testConnection', notImplemented);

	// View commands
	registerCommand(context, 'remote-containers.explorerTargetsRefresh', async () => {
		if (devContainersTreeProvider) {
			await devContainersTreeProvider.refresh();
		}
	});
	registerCommand(context, 'remote-containers.explorerDetailsRefresh', notImplemented);
	registerCommand(context, 'remote-containers.showDetails', notImplemented);
	registerCommand(context, 'remote-containers.removeRecentFolder', notImplemented);
	registerCommand(context, 'remote-containers.inspectDockerResource', notImplemented);
	registerCommand(context, 'remote-containers.inspectInBasicDevContainer', notImplemented);

	logger.debug('All commands registered');
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

/**
 * Placeholder for not-yet-implemented commands
 */
async function notImplemented(): Promise<void> {
	await vscode.window.showInformationMessage(
		'This command is not yet implemented. It will be available in a future phase.'
	);
}

// --- Start Positron ---
// Command implementations (utility commands)

/**
 * Open the dev container configuration file
 */
async function openDevContainerFile(): Promise<void> {
	const logger = getLogger();
	logger.info('Command: openDevContainerFile');

	const currentFolder = Workspace.getCurrentWorkspaceFolder();
	if (!currentFolder) {
		await vscode.window.showErrorMessage('No workspace folder is open');
		return;
	}

	const paths = Workspace.getDevContainerPaths(currentFolder);
	if (!paths) {
		await vscode.window.showErrorMessage('No dev container configuration found');
		return;
	}

	const document = await vscode.workspace.openTextDocument(paths.devContainerJsonPath);
	await vscode.window.showTextDocument(document);
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
	logger.info('Command: showContainerLog');

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
// --- End Positron ---

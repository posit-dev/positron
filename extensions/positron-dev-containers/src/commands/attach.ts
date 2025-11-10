/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { getLogger } from '../common/logger';
import { getDevContainerManager } from '../container/devContainerManager';
import { DevContainerTreeItem } from '../views/devContainersTreeProvider';

/**
 * Attach to a running container selected from a quick pick menu
 */
export async function attachToRunningContainer(): Promise<void> {
	const logger = getLogger();
	logger.info('Command: attachToRunningContainer');

	try {
		// Get all containers
		const manager = getDevContainerManager();
		const containers = await manager.listDevContainers();

		// Filter to only running containers
		const runningContainers = containers.filter(c => c.state === 'running');

		if (runningContainers.length === 0) {
			await vscode.window.showInformationMessage('No running containers found');
			return;
		}

		// Create quick pick items
		interface ContainerQuickPickItem extends vscode.QuickPickItem {
			container: typeof runningContainers[0];
		}

		const items: ContainerQuickPickItem[] = runningContainers.map(container => ({
			label: container.containerName,
			description: container.workspaceFolder ? `$(folder) ${container.workspaceFolder}` : undefined,
			detail: `ID: ${container.containerId.substring(0, 12)}`,
			container
		}));

		// Show quick pick
		const selected = await vscode.window.showQuickPick(items, {
			placeHolder: 'Select a running container to attach to',
			matchOnDescription: true,
			matchOnDetail: true
		});

		if (!selected) {
			return;
		}

		const containerInfo = selected.container;

		// Get the workspace folder to open
		const workspaceFolder = containerInfo.workspaceFolder;
		if (!workspaceFolder) {
			await vscode.window.showErrorMessage('No workspace folder found for this container');
			return;
		}

		// Build the remote URI
		const remoteUri = vscode.Uri.parse(
			`vscode-remote://dev-container+${containerInfo.containerId}/workspaces/${workspaceFolder.split(/[/\\]/).pop()}`
		);

		logger.info(`Opening container in new window: ${remoteUri.toString()}`);

		// Open the folder in a new window
		await vscode.commands.executeCommand('vscode.openFolder', remoteUri, true);
	} catch (error) {
		logger.error('Failed to attach to running container', error);
		await vscode.window.showErrorMessage(`Failed to attach to running container: ${error}`);
	}
}

/**
 * Attach to a container in the current window
 */
export async function attachToContainerInCurrentWindow(treeItem?: DevContainerTreeItem): Promise<void> {
	const logger = getLogger();
	logger.info('Command: attachToContainerInCurrentWindow');

	if (!treeItem || !treeItem.containerInfo) {
		await vscode.window.showErrorMessage('No container selected');
		return;
	}

	const containerInfo = treeItem.containerInfo;

	try {
		// Start the container if it's stopped
		const manager = getDevContainerManager();
		if (containerInfo.state !== 'running') {
			logger.info(`Starting container: ${containerInfo.containerId}`);
			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: `Starting container ${containerInfo.containerName}...`,
					cancellable: false
				},
				async () => {
					await manager.startContainer(containerInfo.containerId);
				}
			);
		}

		// Get the workspace folder to open
		const workspaceFolder = containerInfo.workspaceFolder;
		if (!workspaceFolder) {
			await vscode.window.showErrorMessage('No workspace folder found for this container');
			return;
		}

		// Build the remote URI
		// Format: vscode-remote://dev-container+<containerId>/path/to/workspace
		const remoteUri = vscode.Uri.parse(
			`vscode-remote://dev-container+${containerInfo.containerId}/workspaces/${workspaceFolder.split(/[/\\]/).pop()}`
		);

		logger.info(`Opening container in current window: ${remoteUri.toString()}`);

		// Open the folder in the current window
		await vscode.commands.executeCommand('vscode.openFolder', remoteUri, false);
	} catch (error) {
		logger.error('Failed to attach to container', error);
		await vscode.window.showErrorMessage(`Failed to attach to container: ${error}`);
	}
}

/**
 * Attach to a container in a new window
 */
export async function attachToContainerInNewWindow(treeItem?: DevContainerTreeItem): Promise<void> {
	const logger = getLogger();
	logger.info('Command: attachToContainerInNewWindow');

	if (!treeItem || !treeItem.containerInfo) {
		await vscode.window.showErrorMessage('No container selected');
		return;
	}

	const containerInfo = treeItem.containerInfo;

	try {
		// Start the container if it's stopped
		const manager = getDevContainerManager();
		if (containerInfo.state !== 'running') {
			logger.info(`Starting container: ${containerInfo.containerId}`);
			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: `Starting container ${containerInfo.containerName}...`,
					cancellable: false
				},
				async () => {
					await manager.startContainer(containerInfo.containerId);
				}
			);
		}

		// Get the workspace folder to open
		const workspaceFolder = containerInfo.workspaceFolder;
		if (!workspaceFolder) {
			await vscode.window.showErrorMessage('No workspace folder found for this container');
			return;
		}

		// Build the remote URI
		const remoteUri = vscode.Uri.parse(
			`vscode-remote://dev-container+${containerInfo.containerId}/workspaces/${workspaceFolder.split(/[/\\]/).pop()}`
		);

		logger.info(`Opening container in new window: ${remoteUri.toString()}`);

		// Open the folder in a new window
		await vscode.commands.executeCommand('vscode.openFolder', remoteUri, true);
	} catch (error) {
		logger.error('Failed to attach to container', error);
		await vscode.window.showErrorMessage(`Failed to attach to container: ${error}`);
	}
}

/**
 * Stop a running container
 */
export async function stopContainer(treeItem?: DevContainerTreeItem): Promise<void> {
	const logger = getLogger();
	logger.info('Command: stopContainer');

	if (!treeItem || !treeItem.containerInfo) {
		await vscode.window.showErrorMessage('No container selected');
		return;
	}

	const containerInfo = treeItem.containerInfo;

	// Check if the container is already stopped
	if (containerInfo.state !== 'running') {
		await vscode.window.showWarningMessage(`Container '${containerInfo.containerName}' is not running`);
		return;
	}

	try {
		logger.info(`Stopping container: ${containerInfo.containerId}`);

		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: `Stopping container ${containerInfo.containerName}...`,
				cancellable: false
			},
			async () => {
				const manager = getDevContainerManager();
				await manager.stopContainer(containerInfo.containerId);
			}
		);

		await vscode.window.showInformationMessage(`Container '${containerInfo.containerName}' stopped successfully`);

		// Refresh the tree view
		await vscode.commands.executeCommand('remote-containers.explorerTargetsRefresh');
	} catch (error) {
		logger.error('Failed to stop container', error);
		await vscode.window.showErrorMessage(`Failed to stop container: ${error}`);
	}
}

/**
 * Start a stopped container
 */
export async function startContainer(treeItem?: DevContainerTreeItem): Promise<void> {
	const logger = getLogger();
	logger.info('Command: startContainer');

	if (!treeItem || !treeItem.containerInfo) {
		await vscode.window.showErrorMessage('No container selected');
		return;
	}

	const containerInfo = treeItem.containerInfo;

	// Check if the container is already running
	if (containerInfo.state === 'running') {
		await vscode.window.showWarningMessage(`Container '${containerInfo.containerName}' is already running`);
		return;
	}

	try {
		logger.info(`Starting container: ${containerInfo.containerId}`);

		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: `Starting container ${containerInfo.containerName}...`,
				cancellable: false
			},
			async () => {
				const manager = getDevContainerManager();
				await manager.startContainer(containerInfo.containerId);
			}
		);

		await vscode.window.showInformationMessage(`Container '${containerInfo.containerName}' started successfully`);

		// Refresh the tree view
		await vscode.commands.executeCommand('remote-containers.explorerTargetsRefresh');
	} catch (error) {
		logger.error('Failed to start container', error);
		await vscode.window.showErrorMessage(`Failed to start container: ${error}`);
	}
}

/**
 * Remove a container
 */
export async function removeContainer(treeItem?: DevContainerTreeItem): Promise<void> {
	const logger = getLogger();
	logger.info('Command: removeContainer');

	if (!treeItem || !treeItem.containerInfo) {
		await vscode.window.showErrorMessage('No container selected');
		return;
	}

	const containerInfo = treeItem.containerInfo;

	// Confirm deletion
	const answer = await positron.window.showSimpleModalDialogPrompt(
		'Remove Container',
		`Are you sure you want to remove container '${containerInfo.containerName}'?`,
		'Remove',
		'Cancel'
	);

	if (!answer) {
		return;
	}

	try {
		logger.info(`Removing container: ${containerInfo.containerId}`);

		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: `Removing container ${containerInfo.containerName}...`,
				cancellable: false
			},
			async () => {
				const manager = getDevContainerManager();
				await manager.removeContainer(containerInfo.containerId, true);
			}
		);

		await vscode.window.showInformationMessage(`Container '${containerInfo.containerName}' removed successfully`);

		// Refresh the tree view
		await vscode.commands.executeCommand('remote-containers.explorerTargetsRefresh');
	} catch (error) {
		logger.error('Failed to remove container', error);
		await vscode.window.showErrorMessage(`Failed to remove container: ${error}`);
	}
}

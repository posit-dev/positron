/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getLogger } from '../common/logger';
import { getDevContainerManager } from '../container/devContainerManager';
import { DevContainerTreeItem } from '../views/devContainersTreeProvider';

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
	const answer = await vscode.window.showWarningMessage(
		`Are you sure you want to remove container '${containerInfo.containerName}'?`,
		{ modal: true },
		'Remove'
	);

	if (answer !== 'Remove') {
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

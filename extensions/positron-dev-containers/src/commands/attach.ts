/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { getLogger } from '../common/logger';
import { getDevContainerManager } from '../container/devContainerManager';
import { DevContainerTreeItem } from '../views/devContainersTreeProvider';
import { WorkspaceMappingStorage } from '../common/workspaceMappingStorage';
import { encodeDevContainerAuthority } from '../common/authorityEncoding';

/**
 * Attach to a running container selected from a quick pick menu
 */
export async function attachToRunningContainer(): Promise<void> {
	const logger = getLogger();
	logger.debug('Command: attachToRunningContainer');

	try {
		// Get all containers
		const manager = getDevContainerManager();
		const containers = await manager.listDevContainers();

		// Filter to only running containers
		const runningContainers = containers.filter(c => c.state === 'running');

		if (runningContainers.length === 0) {
			await vscode.window.showInformationMessage(vscode.l10n.t('No running containers found'));
			return;
		}

		// Create quick pick items
		interface ContainerQuickPickItem extends vscode.QuickPickItem {
			container: typeof runningContainers[0];
		}

		const items: ContainerQuickPickItem[] = runningContainers.map(container => ({
			label: container.containerName,
			description: container.workspaceFolder ? `$(folder) ${container.workspaceFolder}` : undefined,
			detail: vscode.l10n.t('ID: {0}', container.containerId.substring(0, 12)),
			container
		}));

		// Show quick pick
		const selected = await vscode.window.showQuickPick(items, {
			placeHolder: vscode.l10n.t('Select a running container to attach to'),
			matchOnDescription: true,
			matchOnDetail: true
		});

		if (!selected) {
			return;
		}

		const containerInfo = selected.container;

		// Get the workspace folder to open (this is the LOCAL folder path from container labels)
		const localWorkspaceFolder = containerInfo.workspaceFolder;
		if (!localWorkspaceFolder) {
			await vscode.window.showErrorMessage(vscode.l10n.t('No workspace folder found for this container'));
			return;
		}

		// Determine the remote workspace path
		const workspaceName = localWorkspaceFolder.split(/[/\\]/).pop();
		const remoteWorkspaceFolder = `/workspaces/${workspaceName}`;

		// Store workspace mapping BEFORE opening the window
		// This ensures the mapping is available when the ConnectionManager resolves the authority
		try {
			const storage = WorkspaceMappingStorage.getInstance();
			await storage.set(containerInfo.containerId, localWorkspaceFolder, remoteWorkspaceFolder);
			logger.info(`Stored workspace mapping: ${containerInfo.containerId} -> ${localWorkspaceFolder}`);
		} catch (error) {
			logger.error('Failed to store workspace mapping', error);
			// Continue anyway - ConnectionManager will try to determine paths from container
		}

		// Build the remote URI using workspace name for display
		const authority = encodeDevContainerAuthority(workspaceName, workspaceName);
		const remoteUri = vscode.Uri.parse(`vscode-remote://${authority}${remoteWorkspaceFolder}`);

		logger.info(`Opening container in new window: ${remoteUri.toString()}`);

		// Open the folder in a new window
		await vscode.commands.executeCommand('vscode.openFolder', remoteUri, true);
	} catch (error) {
		logger.error('Failed to attach to running container', error);
		await vscode.window.showErrorMessage(vscode.l10n.t('Failed to attach to running container: {0}', error));
	}
}

/**
 * Attach to a container in the current window
 */
export async function attachToContainerInCurrentWindow(treeItem?: DevContainerTreeItem): Promise<void> {
	const logger = getLogger();
	logger.debug('Command: attachToContainerInCurrentWindow');

	if (!treeItem || !treeItem.containerInfo) {
		await vscode.window.showErrorMessage(vscode.l10n.t('No container selected'));
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
			)
		}

		// Get the workspace folder to open (this is the LOCAL folder path from container labels)
		const localWorkspaceFolder = containerInfo.workspaceFolder;
		if (!localWorkspaceFolder) {
			await vscode.window.showErrorMessage(vscode.l10n.t('No workspace folder found for this container'));
			return;
		}

		// Determine the remote workspace path
		const workspaceName = localWorkspaceFolder.split(/[/\\]/).pop();
		const remoteWorkspaceFolder = `/workspaces/${workspaceName}`;

		// Store workspace mapping BEFORE opening the window
		try {
			const storage = WorkspaceMappingStorage.getInstance();
			await storage.set(containerInfo.containerId, localWorkspaceFolder, remoteWorkspaceFolder);
			logger.info(`Stored workspace mapping: ${containerInfo.containerId} -> ${localWorkspaceFolder}`);
		} catch (error) {
			logger.error('Failed to store workspace mapping', error);
			// Continue anyway - ConnectionManager will try to determine paths from container
		}

		// Build the remote URI using workspace name for display
		const authority = encodeDevContainerAuthority(workspaceName, workspaceName);
		const remoteUri = vscode.Uri.parse(`vscode-remote://${authority}${remoteWorkspaceFolder}`);

		logger.info(`Opening container in current window: ${remoteUri.toString()}`);

		// Open the folder in the current window
		await vscode.commands.executeCommand('vscode.openFolder', remoteUri, false);
	} catch (error) {
		logger.error('Failed to attach to container', error);
		await vscode.window.showErrorMessage(vscode.l10n.t('Failed to attach to container: {0}', error));
	}
}

/**
 * Attach to a container in a new window
 */
export async function attachToContainerInNewWindow(treeItem?: DevContainerTreeItem): Promise<void> {
	const logger = getLogger();
	logger.debug('Command: attachToContainerInNewWindow');

	if (!treeItem || !treeItem.containerInfo) {
		await vscode.window.showErrorMessage(vscode.l10n.t('No container selected'));
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

		// Get the workspace folder to open (this is the LOCAL folder path from container labels)
		const localWorkspaceFolder = containerInfo.workspaceFolder;
		if (!localWorkspaceFolder) {
			await vscode.window.showErrorMessage('No workspace folder found for this container');
			return;
		}

		// Determine the remote workspace path
		const workspaceName = localWorkspaceFolder.split(/[/\\]/).pop();
		const remoteWorkspaceFolder = `/workspaces/${workspaceName}`;

		// Store workspace mapping BEFORE opening the window
		try {
			const storage = WorkspaceMappingStorage.getInstance();
			await storage.set(containerInfo.containerId, localWorkspaceFolder, remoteWorkspaceFolder);
			logger.info(`Stored workspace mapping: ${containerInfo.containerId} -> ${localWorkspaceFolder}`);
		} catch (error) {
			logger.error('Failed to store workspace mapping', error);
			// Continue anyway - ConnectionManager will try to determine paths from container
		}

		// Build the remote URI using workspace name for display
		const authority = encodeDevContainerAuthority(workspaceName, workspaceName);
		const remoteUri = vscode.Uri.parse(`vscode-remote://${authority}${remoteWorkspaceFolder}`);

		logger.info(`Opening container in new window: ${remoteUri.toString()}`);

		// Open the folder in a new window
		await vscode.commands.executeCommand('vscode.openFolder', remoteUri, true);
	} catch (error) {
		logger.error('Failed to attach to container', error);
		await vscode.window.showErrorMessage(vscode.l10n.t('Failed to attach to container: {0}', error));
	}
}

/**
 * Stop a running container
 */
export async function stopContainer(treeItem?: DevContainerTreeItem): Promise<void> {
	const logger = getLogger();
	logger.debug('Command: stopContainer');

	if (!treeItem || !treeItem.containerInfo) {
		await vscode.window.showErrorMessage(vscode.l10n.t('No container selected'));
		return;
	}

	const containerInfo = treeItem.containerInfo;

	// Check if the container is already stopped
	if (containerInfo.state !== 'running') {
		await vscode.window.showWarningMessage(vscode.l10n.t("Container '{0}' is not running", containerInfo.containerName));
		return;
	}

	try {
		logger.info(`Stopping container: ${containerInfo.containerId}`);

		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: vscode.l10n.t('Stopping container {0}...', containerInfo.containerName),
				cancellable: false
			},
			async () => {
				const manager = getDevContainerManager();
				await manager.stopContainer(containerInfo.containerId);
			}
		);

		// Refresh the tree view
		await vscode.commands.executeCommand('remote-containers.explorerTargetsRefresh');

		await vscode.window.showInformationMessage(vscode.l10n.t("Container '{0}' stopped successfully", containerInfo.containerName));

	} catch (error) {
		logger.error('Failed to stop container', error);
		await vscode.window.showErrorMessage(vscode.l10n.t('Failed to stop container: {0}', error));
	}
}

/**
 * Start a stopped container
 */
export async function startContainer(treeItem?: DevContainerTreeItem): Promise<void> {
	const logger = getLogger();
	logger.debug('Command: startContainer');

	if (!treeItem || !treeItem.containerInfo) {
		await vscode.window.showErrorMessage(vscode.l10n.t('No container selected'));
		return;
	}

	const containerInfo = treeItem.containerInfo;

	// Check if the container is already running
	if (containerInfo.state === 'running') {
		await vscode.window.showWarningMessage(vscode.l10n.t("Container '{0}' is already running", containerInfo.containerName));
		return;
	}

	try {
		logger.info(`Starting container: ${containerInfo.containerId}`);

		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: vscode.l10n.t('Starting container {0}...', containerInfo.containerName),
				cancellable: false
			},
			async () => {
				const manager = getDevContainerManager();
				await manager.startContainer(containerInfo.containerId);
			}
		);

		await vscode.window.showInformationMessage(vscode.l10n.t("Container '{0}' started successfully", containerInfo.containerName));

		// Refresh the tree view
		await vscode.commands.executeCommand('remote-containers.explorerTargetsRefresh');
	} catch (error) {
		logger.error('Failed to start container', error);
		await vscode.window.showErrorMessage(vscode.l10n.t('Failed to start container: {0}', error));
	}
}

/**
 * Remove a container
 */
export async function removeContainer(treeItem?: DevContainerTreeItem): Promise<void> {
	const logger = getLogger();
	logger.debug('Command: removeContainer');

	if (!treeItem || !treeItem.containerInfo) {
		await vscode.window.showErrorMessage(vscode.l10n.t('No container selected'));
		return;
	}

	const containerInfo = treeItem.containerInfo;

	// Confirm deletion
	const answer = await positron.window.showSimpleModalDialogPrompt(
		vscode.l10n.t('Remove Container'),
		vscode.l10n.t("Are you sure you want to remove container '{0}'?", containerInfo.containerName),
		vscode.l10n.t('Remove'),
		vscode.l10n.t('Cancel')
	);

	if (!answer) {
		return;
	}

	try {
		logger.info(`Removing container: ${containerInfo.containerId}`);

		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: vscode.l10n.t('Removing container {0}...', containerInfo.containerName),
				cancellable: false
			},
			async () => {
				const manager = getDevContainerManager();
				await manager.removeContainer(containerInfo.containerId, true);
			}
		);

		// Refresh the tree view
		await vscode.commands.executeCommand('remote-containers.explorerTargetsRefresh');

		await vscode.window.showInformationMessage(vscode.l10n.t("Container '{0}' removed successfully", containerInfo.containerName));

	} catch (error) {
		logger.error('Failed to remove container', error);
		await vscode.window.showErrorMessage(vscode.l10n.t('Failed to remove container: {0}', error));
	}
}

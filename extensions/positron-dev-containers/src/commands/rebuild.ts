/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getLogger } from '../common/logger';
import { Workspace } from '../common/workspace';
import { getDevContainerManager } from '../container/devContainerManager';
import { RebuildStateManager, PendingRebuild } from '../common/rebuildState';
import { encodeDevContainerAuthority } from '../common/authorityEncoding';
import { WorkspaceMappingStorage } from '../common/workspaceMappingStorage';

/**
 * Rebuild and reopen the current workspace in a dev container
 */
export async function rebuildAndReopenInContainer(): Promise<void> {
	const logger = getLogger();
	logger.info('Command: rebuildAndReopenInContainer');

	try {
		// Get current workspace folder
		const workspaceFolder = Workspace.getCurrentWorkspaceFolder();
		if (!workspaceFolder) {
			await vscode.window.showErrorMessage('No workspace folder is open');
			return;
		}

		// Check if workspace has dev container configuration
		if (!Workspace.hasDevContainer(workspaceFolder)) {
			await vscode.window.showErrorMessage(
				'No dev container configuration found. Create a .devcontainer/devcontainer.json file first.'
			);
			return;
		}

		// Confirm rebuild action
		const confirm = await vscode.window.showWarningMessage(
			'This will rebuild the container and may take several minutes. Continue?',
			{ modal: true },
			'Rebuild'
		);

		if (confirm !== 'Rebuild') {
			return;
		}

		// Rebuild the container (output will be shown in terminal)
		logger.info('Rebuilding dev container...');

		const manager = getDevContainerManager();
		const result = await manager.createOrStartContainer({
			workspaceFolder: workspaceFolder.uri.fsPath,
			rebuild: true,
			noCache: false
		});

		logger.info(`Container rebuilt: ${result.containerId}`);

		// Store workspace mapping BEFORE opening the window
		try {
			const storage = WorkspaceMappingStorage.getInstance();
			await storage.set(result.containerId, workspaceFolder.uri.fsPath, result.remoteWorkspaceFolder);
			logger.info(`Stored workspace mapping: ${result.containerId} -> ${workspaceFolder.uri.fsPath}`);
		} catch (error) {
			logger.error('Failed to store workspace mapping before window reload', error);
		}

		// Reload window with remote authority
		const authority = encodeDevContainerAuthority(result.containerId);
		const remoteUri = vscode.Uri.parse(`vscode-remote://${authority}${result.remoteWorkspaceFolder}`);

		logger.info(`Reloading window with authority: ${authority}`);

		// Reload window with the remote authority
		await vscode.commands.executeCommand('vscode.openFolder', remoteUri);
	} catch (error) {
		logger.error('Failed to rebuild and reopen in container', error);
		await vscode.window.showErrorMessage(
			`Failed to rebuild dev container: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

/**
 * Rebuild (without cache) and reopen the current workspace in a dev container
 */
export async function rebuildNoCacheAndReopenInContainer(): Promise<void> {
	const logger = getLogger();
	logger.info('Command: rebuildNoCacheAndReopenInContainer');

	try {
		// Get current workspace folder
		const workspaceFolder = Workspace.getCurrentWorkspaceFolder();
		if (!workspaceFolder) {
			await vscode.window.showErrorMessage('No workspace folder is open');
			return;
		}

		// Check if workspace has dev container configuration
		if (!Workspace.hasDevContainer(workspaceFolder)) {
			await vscode.window.showErrorMessage(
				'No dev container configuration found. Create a .devcontainer/devcontainer.json file first.'
			);
			return;
		}

		// Confirm rebuild action (no cache is more expensive)
		const confirm = await vscode.window.showWarningMessage(
			'This will rebuild the container without cache and may take a long time. Continue?',
			{ modal: true },
			'Rebuild'
		);

		if (confirm !== 'Rebuild') {
			return;
		}

		// Rebuild the container without cache (output will be shown in terminal)
		logger.info('Rebuilding dev container without cache...');

		const manager = getDevContainerManager();
		const result = await manager.createOrStartContainer({
			workspaceFolder: workspaceFolder.uri.fsPath,
			rebuild: true,
			noCache: true
		});

		logger.info(`Container rebuilt: ${result.containerId}`);

		// Store workspace mapping BEFORE opening the window
		try {
			const storage = WorkspaceMappingStorage.getInstance();
			await storage.set(result.containerId, workspaceFolder.uri.fsPath, result.remoteWorkspaceFolder);
			logger.info(`Stored workspace mapping: ${result.containerId} -> ${workspaceFolder.uri.fsPath}`);
		} catch (error) {
			logger.error('Failed to store workspace mapping before window reload', error);
		}

		// Reload window with remote authority
		const authority = encodeDevContainerAuthority(result.containerId);
		const remoteUri = vscode.Uri.parse(`vscode-remote://${authority}${result.remoteWorkspaceFolder}`);

		logger.info(`Reloading window with authority: ${authority}`);

		// Reload window with the remote authority
		await vscode.commands.executeCommand('vscode.openFolder', remoteUri);
	} catch (error) {
		logger.error('Failed to rebuild (no cache) and reopen in container', error);
		await vscode.window.showErrorMessage(
			`Failed to rebuild dev container: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

/**
 * Rebuild the current dev container (when already in container)
 *
 * This command runs INSIDE the container and schedules a rebuild to happen
 * on the host after the window reloads.
 */
export async function rebuildContainer(context: vscode.ExtensionContext): Promise<void> {
	const logger = getLogger();
	logger.info('Command: rebuildContainer');

	try {
		// Check if in a dev container
		if (!Workspace.isInDevContainer()) {
			await vscode.window.showErrorMessage('You are not currently in a dev container');
			return;
		}

		// Get current workspace folder and remote workspace path
		const workspaceFolder = Workspace.getCurrentWorkspaceFolder();
		if (!workspaceFolder) {
			await vscode.window.showErrorMessage('No workspace folder is open');
			return;
		}

		const remoteWorkspaceFolder = workspaceFolder.uri.fsPath;

		// Extract container ID from remote authority
		const authority = workspaceFolder.uri.authority;
		if (!authority) {
			await vscode.window.showErrorMessage('Cannot determine container ID');
			return;
		}

		// Authority format: dev-container+<containerId>
		const containerId = authority.replace(/^(dev-container|attached-container)\+/, '');
		if (!containerId) {
			await vscode.window.showErrorMessage('Cannot determine container ID from authority');
			return;
		}

		logger.debug(`=== REBUILD: Looking up workspace mapping ===`);
		logger.debug(`Container ID: ${containerId}`);
		logger.debug(`Remote name: ${vscode.env.remoteName}`);
		logger.debug(`Extension context: ${context.extensionMode === vscode.ExtensionMode.Production ? 'production' : 'development'}`);

		// Get local workspace folder from WorkspaceMappingStorage
		// NOTE: This might not work in remote context due to separate extension hosts!
		let localWorkspaceFolder: string | undefined;

		try {
			const storage = WorkspaceMappingStorage.getInstance();
			logger.debug(`Storage instance retrieved, checking for container ${containerId}`);

			const allMappings = storage.getAll();
			logger.debug(`Total mappings in storage: ${allMappings.length}`);
			allMappings.forEach(m => {
				logger.debug(`  Mapping: ${m.containerId} -> ${m.localWorkspacePath}`);
			});

			const mapping = storage.get(containerId);
			if (mapping?.localWorkspacePath) {
				localWorkspaceFolder = mapping.localWorkspacePath;
				logger.info(`Found local workspace path from storage: ${localWorkspaceFolder}`);
			} else {
				logger.warn(`No mapping found for container ${containerId} in storage`);
			}
		} catch (error) {
			logger.error('Failed to get workspace mapping from storage', error);
		}

		// Fallback 1: Try environment variables (legacy support)
		if (!localWorkspaceFolder) {
			localWorkspaceFolder = process.env.LOCAL_WORKSPACE_FOLDER;
			if (localWorkspaceFolder) {
				logger.info(`Found local workspace path from env var: ${localWorkspaceFolder}`);
			}
		}

		if (!localWorkspaceFolder) {
			await vscode.window.showErrorMessage(
				'Cannot determine local workspace folder. Please reopen the container.'
			);
			return;
		}

		// Confirm rebuild action
		const confirm = await vscode.window.showWarningMessage(
			'This will rebuild the container and reload the window. Continue?',
			{ modal: true },
			'Rebuild'
		);

		if (confirm !== 'Rebuild') {
			return;
		}

		// Store rebuild intent for the host to pick up after reload
		const rebuildState = new RebuildStateManager(context);
		const pendingRebuild: PendingRebuild = {
			workspaceFolder: localWorkspaceFolder,
			containerId,
			remoteWorkspaceFolder,
			noCache: false,
			requestedAt: Date.now()
		};

		await rebuildState.setPendingRebuild(pendingRebuild);
		logger.info(`Stored pending rebuild for: ${localWorkspaceFolder}`);

		// Close remote connection and reopen locally
		// The extension on the host will detect the pending rebuild and execute it
		logger.info('Closing remote window to trigger rebuild on host...');
		const localUri = vscode.Uri.file(localWorkspaceFolder);
		await vscode.commands.executeCommand('vscode.openFolder', localUri);
	} catch (error) {
		logger.error('Failed to initiate container rebuild', error);
		await vscode.window.showErrorMessage(
			`Failed to initiate rebuild: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

/**
 * Rebuild the current dev container without cache (when already in container)
 *
 * This command runs INSIDE the container and schedules a rebuild to happen
 * on the host after the window reloads.
 */
export async function rebuildContainerNoCache(context: vscode.ExtensionContext): Promise<void> {
	const logger = getLogger();
	logger.info('Command: rebuildContainerNoCache');

	try {
		// Check if in a dev container
		if (!Workspace.isInDevContainer()) {
			await vscode.window.showErrorMessage('You are not currently in a dev container');
			return;
		}

		// Get current workspace folder and remote workspace path
		const workspaceFolder = Workspace.getCurrentWorkspaceFolder();
		if (!workspaceFolder) {
			await vscode.window.showErrorMessage('No workspace folder is open');
			return;
		}

		const remoteWorkspaceFolder = workspaceFolder.uri.fsPath;

		// Extract container ID from remote authority
		const authority = workspaceFolder.uri.authority;
		if (!authority) {
			await vscode.window.showErrorMessage('Cannot determine container ID');
			return;
		}

		// Authority format: dev-container+<containerId>
		const containerId = authority.replace(/^(dev-container|attached-container)\+/, '');
		if (!containerId) {
			await vscode.window.showErrorMessage('Cannot determine container ID from authority');
			return;
		}

		logger.debug(`=== REBUILD NO CACHE: Looking up workspace mapping ===`);
		logger.debug(`Container ID: ${containerId}`);
		logger.debug(`Remote name: ${vscode.env.remoteName}`);

		// Get local workspace folder from WorkspaceMappingStorage
		// NOTE: This might not work in remote context due to separate extension hosts!
		let localWorkspaceFolder: string | undefined;

		try {
			const storage = WorkspaceMappingStorage.getInstance();
			logger.debug(`Storage instance retrieved, checking for container ${containerId}`);

			const allMappings = storage.getAll();
			logger.debug(`Total mappings in storage: ${allMappings.length}`);
			allMappings.forEach(m => {
				logger.debug(`  Mapping: ${m.containerId} -> ${m.localWorkspacePath}`);
			});

			const mapping = storage.get(containerId);
			if (mapping?.localWorkspacePath) {
				localWorkspaceFolder = mapping.localWorkspacePath;
				logger.info(`Found local workspace path from storage: ${localWorkspaceFolder}`);
			} else {
				logger.warn(`No mapping found for container ${containerId} in storage`);
			}
		} catch (error) {
			logger.error('Failed to get workspace mapping from storage', error);
		}

		// Fallback: Try environment variables (legacy support)
		if (!localWorkspaceFolder) {
			localWorkspaceFolder = process.env.LOCAL_WORKSPACE_FOLDER;
			if (localWorkspaceFolder) {
				logger.info(`Found local workspace path from env var: ${localWorkspaceFolder}`);
			}
		}

		if (!localWorkspaceFolder) {
			await vscode.window.showErrorMessage(
				'Cannot determine local workspace folder. Please reopen the container.'
			);
			return;
		}

		// Confirm rebuild action
		const confirm = await vscode.window.showWarningMessage(
			'This will rebuild the container without cache and reload the window. This may take a long time. Continue?',
			{ modal: true },
			'Rebuild'
		);

		if (confirm !== 'Rebuild') {
			return;
		}

		// Store rebuild intent for the host to pick up after reload
		const rebuildState = new RebuildStateManager(context);
		const pendingRebuild: PendingRebuild = {
			workspaceFolder: localWorkspaceFolder,
			containerId,
			remoteWorkspaceFolder,
			noCache: true,
			requestedAt: Date.now()
		};

		await rebuildState.setPendingRebuild(pendingRebuild);
		logger.info(`Stored pending rebuild (no cache) for: ${localWorkspaceFolder}`);

		// Close remote connection and reopen locally
		logger.info('Closing remote window to trigger rebuild on host...');
		const localUri = vscode.Uri.file(localWorkspaceFolder);
		await vscode.commands.executeCommand('vscode.openFolder', localUri);
	} catch (error) {
		logger.error('Failed to initiate container rebuild (no cache)', error);
		await vscode.window.showErrorMessage(
			`Failed to initiate rebuild: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

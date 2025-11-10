/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getLogger } from '../common/logger';
import { Workspace } from '../common/workspace';
import { getDevContainerManager } from '../container/devContainerManager';
import { RebuildStateManager, PendingRebuild } from '../common/rebuildState';
import { decodeDevContainerAuthority, encodeDevContainerAuthority } from '../common/authorityEncoding';

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

		// Reload window with remote authority
		// Encode local workspace path in authority so it can be retrieved later
		const authority = encodeDevContainerAuthority(result.containerId, workspaceFolder.uri.fsPath);
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

		// Reload window with remote authority
		// Encode local workspace path in authority so it can be retrieved later
		const authority = encodeDevContainerAuthority(result.containerId, workspaceFolder.uri.fsPath);
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

		// Get local workspace folder from environment variables set during connection
		// These are set by the connection manager when establishing the remote connection
		logger.debug('=== REBUILD: Checking environment variables ===');
		logger.debug(`process.env.LOCAL_WORKSPACE_FOLDER: ${process.env.LOCAL_WORKSPACE_FOLDER}`);
		logger.debug(`process.env.REMOTE_WORKSPACE_FOLDER: ${process.env.REMOTE_WORKSPACE_FOLDER}`);
		logger.debug(`process.env.POSITRON_CONTAINER_ID: ${process.env.POSITRON_CONTAINER_ID}`);
		logger.debug('All env vars starting with LOCAL_, REMOTE_, or POSITRON_:');
		Object.keys(process.env).filter(k => k.startsWith('LOCAL_') || k.startsWith('REMOTE_') || k.startsWith('POSITRON_')).forEach(k => {
			logger.debug(`  ${k}: ${process.env[k]}`);
		});
		logger.debug(`Total env vars: ${Object.keys(process.env).length}`);
		logger.debug(`First 20 env vars: ${Object.keys(process.env).slice(0, 20).join(', ')}`);

		// Try accessing via vscode.env if available
		const vscodeEnv = (vscode.env as any);
		logger.debug(`vscode.env keys: ${Object.keys(vscodeEnv).join(', ')}`);

		let localWorkspaceFolder = process.env.LOCAL_WORKSPACE_FOLDER;

		// Fallback: Try to decode from authority if env var not available
		if (!localWorkspaceFolder) {
			logger.warn('LOCAL_WORKSPACE_FOLDER not in process.env, trying to decode from authority');
			const decoded = decodeDevContainerAuthority(authority);
			if (decoded?.localWorkspacePath) {
				localWorkspaceFolder = decoded.localWorkspacePath;
				logger.info(`Decoded local workspace path from authority: ${localWorkspaceFolder}`);
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

		// Get local workspace folder from environment variables set during connection
		let localWorkspaceFolder = process.env.LOCAL_WORKSPACE_FOLDER;

		// Fallback: Try to decode from authority if env var not available
		if (!localWorkspaceFolder) {
			logger.warn('LOCAL_WORKSPACE_FOLDER not in process.env, trying to decode from authority');
			const decoded = decodeDevContainerAuthority(authority);
			if (decoded?.localWorkspacePath) {
				localWorkspaceFolder = decoded.localWorkspacePath;
				logger.info(`Decoded local workspace path from authority: ${localWorkspaceFolder}`);
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

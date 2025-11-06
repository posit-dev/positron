/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getLogger } from '../common/logger';
import { Workspace } from '../common/workspace';
import { getDevContainerManager } from '../container/devContainerManager';

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
		const authority = `dev-container+${result.containerId}`;
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
		const authority = `dev-container+${result.containerId}`;
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
 */
export async function rebuildContainer(): Promise<void> {
	const logger = getLogger();
	logger.info('Command: rebuildContainer');

	try {
		// Check if in a dev container
		if (!Workspace.isInDevContainer()) {
			await vscode.window.showErrorMessage('You are not currently in a dev container');
			return;
		}

		// Get the local workspace folder path
		const localPath = await Workspace.getLocalWorkspaceFolder();
		if (!localPath) {
			await vscode.window.showErrorMessage(
				'Cannot determine workspace folder for rebuild'
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

		// Rebuild the container (output will be shown in terminal)
		logger.info('Rebuilding dev container...');

		const manager = getDevContainerManager();
		const result = await manager.createOrStartContainer({
			workspaceFolder: localPath,
			rebuild: true,
			noCache: false
		});

		logger.info(`Container rebuilt: ${result.containerId}`);

		// Reload window with remote authority
		const authority = `dev-container+${result.containerId}`;
		const remoteUri = vscode.Uri.parse(`vscode-remote://${authority}${result.remoteWorkspaceFolder}`);

		logger.info(`Reloading window with authority: ${authority}`);

		// Reload window with the remote authority
		await vscode.commands.executeCommand('vscode.openFolder', remoteUri);
	} catch (error) {
		logger.error('Failed to rebuild container', error);
		await vscode.window.showErrorMessage(
			`Failed to rebuild container: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

/**
 * Rebuild the current dev container without cache (when already in container)
 */
export async function rebuildContainerNoCache(): Promise<void> {
	const logger = getLogger();
	logger.info('Command: rebuildContainerNoCache');

	try {
		// Check if in a dev container
		if (!Workspace.isInDevContainer()) {
			await vscode.window.showErrorMessage('You are not currently in a dev container');
			return;
		}

		// Get the local workspace folder path
		const localPath = await Workspace.getLocalWorkspaceFolder();
		if (!localPath) {
			await vscode.window.showErrorMessage(
				'Cannot determine workspace folder for rebuild'
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

		// Rebuild the container without cache (output will be shown in terminal)
		logger.info('Rebuilding dev container without cache...');

		const manager = getDevContainerManager();
		const result = await manager.createOrStartContainer({
			workspaceFolder: localPath,
			rebuild: true,
			noCache: true
		});

		logger.info(`Container rebuilt: ${result.containerId}`);

		// Reload window with remote authority
		const authority = `dev-container+${result.containerId}`;
		const remoteUri = vscode.Uri.parse(`vscode-remote://${authority}${result.remoteWorkspaceFolder}`);

		logger.info(`Reloading window with authority: ${authority}`);

		// Reload window with the remote authority
		await vscode.commands.executeCommand('vscode.openFolder', remoteUri);
	} catch (error) {
		logger.error('Failed to rebuild container (no cache)', error);
		await vscode.window.showErrorMessage(
			`Failed to rebuild container: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

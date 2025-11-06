/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getLogger } from '../common/logger';
import { Workspace } from '../common/workspace';
import { getDevContainerManager } from '../container/devContainerManager';

/**
 * Reopen the current workspace in a dev container
 */
export async function reopenInContainer(): Promise<void> {
	const logger = getLogger();
	logger.info('Command: reopenInContainer');

	try {
		// Check if already in a dev container
		if (Workspace.isInDevContainer()) {
			await vscode.window.showInformationMessage('You are already in a dev container');
			return;
		}

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

		// Build/Start Container (output will be shown in terminal)
		logger.info('Building/starting dev container...');

		const manager = getDevContainerManager();
		const result = await manager.createOrStartContainer({
			workspaceFolder: workspaceFolder.uri.fsPath,
			rebuild: false,
			noCache: false
		});

		logger.info(`Container ready: ${result.containerId}`);

		// Reload window with remote authority
		const authority = `dev-container+${result.containerId}`;
		const remoteUri = vscode.Uri.parse(`vscode-remote://${authority}${result.remoteWorkspaceFolder}`);

		logger.info(`Reloading window with authority: ${authority}`);
		logger.info(`Remote workspace: ${result.remoteWorkspaceFolder}`);

		// Reload window with the remote authority
		// The authority resolver will handle installing the server and establishing the connection
		logger.info(`===== REOPENING WINDOW WITH REMOTE URI =====`);
		logger.info(`About to execute vscode.openFolder with URI: ${remoteUri.toString()}`);
		await vscode.commands.executeCommand('vscode.openFolder', remoteUri);
		logger.info(`vscode.openFolder command completed`);
	} catch (error) {
		logger.error('Failed to reopen in container', error);
		await vscode.window.showErrorMessage(
			`Failed to open in dev container: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

/**
 * Reopen the current workspace locally (exit dev container)
 */
export async function reopenLocally(): Promise<void> {
	const logger = getLogger();
	logger.info('Command: reopenLocally');

	try {
		// Check if in a dev container
		if (!Workspace.isInDevContainer()) {
			await vscode.window.showInformationMessage('You are not currently in a dev container');
			return;
		}

		// Get the local workspace folder path from the remote workspace
		// The CONTAINER_WORKSPACE_FOLDER environment variable should contain the local path
		const localPath = await Workspace.getLocalWorkspaceFolder();
		if (!localPath) {
			await vscode.window.showErrorMessage(
				'Cannot determine local workspace folder. Please reopen the workspace manually.'
			);
			return;
		}

		logger.info(`Reopening workspace locally: ${localPath}`);

		// Open the local folder
		const localUri = vscode.Uri.file(localPath);
		await vscode.commands.executeCommand('vscode.openFolder', localUri);
	} catch (error) {
		logger.error('Failed to reopen locally', error);
		await vscode.window.showErrorMessage(
			`Failed to reopen locally: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

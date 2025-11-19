/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { getLogger } from '../common/logger';
import { Workspace } from '../common/workspace';
import { getDevContainerManager } from '../container/devContainerManager';

/**
 * Open a folder in a dev container (shows folder picker)
 */
export async function openFolder(): Promise<void> {
	const logger = getLogger();
	logger.debug('Command: openFolder');

	try {
		// Show folder picker
		const folderUris = await vscode.window.showOpenDialog({
			canSelectFiles: false,
			canSelectFolders: true,
			canSelectMany: false,
			openLabel: vscode.l10n.t('Open in Container'),
			title: vscode.l10n.t('Select Folder to Open in Container')
		});

		if (!folderUris || folderUris.length === 0) {
			return; // User cancelled
		}

		const folderPath = folderUris[0].fsPath;
		logger.info(`Selected folder: ${folderPath}`);

		// Check if folder has dev container configuration
		// Create a temporary WorkspaceFolder object to check for dev container
		const tempFolder: vscode.WorkspaceFolder = {
			uri: folderUris[0],
			name: folderUris[0].fsPath.split('/').pop() || 'folder',
			index: 0
		};
		const hasDevContainer = Workspace.hasDevContainer(tempFolder);
		if (!hasDevContainer) {
			const response = await positron.window.showSimpleModalDialogPrompt(
				vscode.l10n.t('No Dev Container Configuration'),
				vscode.l10n.t('No dev container configuration found in this folder. Do you want to create one?'),
				vscode.l10n.t('Create Configuration'),
				vscode.l10n.t('Cancel')
			);

			if (response) {
				// Open the folder first, then let user create the configuration
				await vscode.commands.executeCommand('vscode.openFolder', folderUris[0]);
				// Suggest creating dev container file
				await vscode.window.showInformationMessage(
					vscode.l10n.t('Use "Dev Containers: Add Dev Container Configuration Files..." to create a configuration.'),
					vscode.l10n.t('OK')
				);
			}
			return;
		}

		// Open folder in container
		await openFolderInContainer(folderPath, false);
	} catch (error) {
		logger.error('Failed to open folder in container', error);
		await vscode.window.showErrorMessage(
			vscode.l10n.t('Failed to open folder in container: {0}', error instanceof Error ? error.message : String(error))
		);
	}
}

/**
 * Open a folder in a dev container in the current window
 */
export async function openFolderInContainerInCurrentWindow(folderPath?: string): Promise<void> {
	const logger = getLogger();
	logger.debug('Command: openFolderInContainerInCurrentWindow');

	try {
		// If no folder path provided, show picker
		if (!folderPath) {
			const folderUris = await vscode.window.showOpenDialog({
				canSelectFiles: false,
				canSelectFolders: true,
				canSelectMany: false,
				openLabel: vscode.l10n.t('Open in Container'),
				title: vscode.l10n.t('Select Folder to Open in Container')
			});

			if (!folderUris || folderUris.length === 0) {
				return; // User cancelled
			}

			folderPath = folderUris[0].fsPath;
		}

		logger.info(`Opening folder in container (current window): ${folderPath}`);
		await openFolderInContainer(folderPath, false);
	} catch (error) {
		logger.error('Failed to open folder in container', error);
		await vscode.window.showErrorMessage(
			vscode.l10n.t('Failed to open folder in container: {0}', error instanceof Error ? error.message : String(error))
		);
	}
}

/**
 * Open a folder in a dev container in a new window
 */
export async function openFolderInContainerInNewWindow(folderPath?: string): Promise<void> {
	const logger = getLogger();
	logger.debug('Command: openFolderInContainerInNewWindow');

	try {
		// If no folder path provided, show picker
		if (!folderPath) {
			const folderUris = await vscode.window.showOpenDialog({
				canSelectFiles: false,
				canSelectFolders: true,
				canSelectMany: false,
				openLabel: vscode.l10n.t('Open in Container'),
				title: vscode.l10n.t('Select Folder to Open in Container')
			});

			if (!folderUris || folderUris.length === 0) {
				return; // User cancelled
			}

			folderPath = folderUris[0].fsPath;
		}

		logger.info(`Opening folder in container (new window): ${folderPath}`);
		await openFolderInContainer(folderPath, true);
	} catch (error) {
		logger.error('Failed to open folder in container', error);
		await vscode.window.showErrorMessage(
			vscode.l10n.t('Failed to open folder in container: {0}', error instanceof Error ? error.message : String(error))
		);
	}
}

/**
 * Open a workspace file in a dev container
 */
export async function openWorkspace(): Promise<void> {
	const logger = getLogger();
	logger.debug('Command: openWorkspace');

	try {
		// Show workspace file picker
		const workspaceUris = await vscode.window.showOpenDialog({
			canSelectFiles: true,
			canSelectFolders: false,
			canSelectMany: false,
			openLabel: vscode.l10n.t('Open Workspace in Container'),
			title: vscode.l10n.t('Select Workspace File to Open in Container'),
			filters: {
				[vscode.l10n.t('Workspace Files')]: ['code-workspace']
			}
		});

		if (!workspaceUris || workspaceUris.length === 0) {
			return; // User cancelled
		}

		const workspacePath = workspaceUris[0].fsPath;
		logger.info(`Selected workspace: ${workspacePath}`);

		// For now, we'll open the workspace locally and let user reopen in container
		// Full workspace support requires handling multi-root workspaces
		await vscode.commands.executeCommand('vscode.openFolder', workspaceUris[0]);

		await vscode.window.showInformationMessage(
			vscode.l10n.t('Workspace opened. Use "Reopen in Container" to open it in a dev container.'),
			vscode.l10n.t('OK')
		);
	} catch (error) {
		logger.error('Failed to open workspace', error);
		await vscode.window.showErrorMessage(
			vscode.l10n.t('Failed to open workspace: {0}', error instanceof Error ? error.message : String(error))
		);
	}
}

/**
 * Helper function to open a folder in a container
 * @param folderPath Path to the folder to open
 * @param forceNewWindow Whether to force opening in a new window
 */
async function openFolderInContainer(folderPath: string, forceNewWindow: boolean): Promise<void> {
	const logger = getLogger();

	// Verify folder has dev container configuration
	const folderUri = vscode.Uri.file(folderPath);
	const tempFolder: vscode.WorkspaceFolder = {
		uri: folderUri,
		name: folderUri.fsPath.split('/').pop() || 'folder',
		index: 0
	};
	if (!Workspace.hasDevContainer(tempFolder)) {
		await vscode.window.showErrorMessage(
			vscode.l10n.t('No dev container configuration found. Create a .devcontainer/devcontainer.json or .devcontainer.json file first.')
		);
		return;
	}

	// Build/Start Container (output will be shown in terminal)
	logger.info('Building/starting dev container...');

	const manager = getDevContainerManager();
	const result = await manager.createOrStartContainer({
		workspaceFolder: folderPath,
		rebuild: false,
		noCache: false
	});

	logger.info(`Container ready: ${result.containerId}`);

	// Validate that workspace folder is properly determined
	if (!result.remoteWorkspaceFolder) {
		throw new Error('Remote workspace folder not determined. Workspace may not be mounted.');
	}

	// Open the folder with remote authority
	const authority = `dev-container+${result.containerId}`;
	const remoteUri = vscode.Uri.parse(`vscode-remote://${authority}${result.remoteWorkspaceFolder}`);

	logger.info(`Opening folder with authority: ${authority}`);
	logger.info(`Remote workspace: ${result.remoteWorkspaceFolder}`);

	// Open folder with the remote authority
	await vscode.commands.executeCommand(
		'vscode.openFolder',
		remoteUri,
		forceNewWindow
	);
}

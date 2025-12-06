/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { getLogger } from '../common/logger';
import { Workspace } from '../common/workspace';
import { getDevContainerManager } from '../container/devContainerManager';
import { RebuildStateManager, PendingRebuild } from '../common/rebuildState';
import { encodeDevContainerAuthority, decodeDevContainerAuthority } from '../common/authorityEncoding';
import { WorkspaceMappingStorage } from '../common/workspaceMappingStorage';

/**
 * Rebuild and reopen the current workspace in a dev container
 */
export async function rebuildAndReopenInContainer(): Promise<void> {
	const logger = getLogger();
	logger.debug('Command: rebuildAndReopenInContainer');

	try {
		// Get current workspace folder
		const workspaceFolder = Workspace.getCurrentWorkspaceFolder();
		if (!workspaceFolder) {
			await vscode.window.showErrorMessage(vscode.l10n.t('No workspace folder is open'));
			return;
		}

		// Check if workspace has dev container configuration
		// Use async version to work with remote filesystems (inside containers)
		if (!await Workspace.hasDevContainerAsync(workspaceFolder)) {
			await vscode.window.showErrorMessage(
				vscode.l10n.t('No dev container configuration found. Create a .devcontainer/devcontainer.json or .devcontainer.json file first.')
			);
			return;
		}

		// Confirm rebuild action
		const confirm = await positron.window.showSimpleModalDialogPrompt(
			vscode.l10n.t('Rebuild Container'),
			vscode.l10n.t('This will rebuild the container and may take several minutes. Continue?'),
			vscode.l10n.t('Rebuild'),
			vscode.l10n.t('Cancel')
		);

		if (!confirm) {
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
		// Extract just the folder name from the remote workspace path
		const workspaceName = result.remoteWorkspaceFolder.split('/').filter(s => s).pop();
		const authority = encodeDevContainerAuthority(result.containerId, workspaceName);
		const remoteUri = vscode.Uri.parse(`vscode-remote://${authority}${result.remoteWorkspaceFolder}`);

		logger.info(`Reloading window with authority: ${authority}`);

		// Reload window with the remote authority
		await vscode.commands.executeCommand('vscode.openFolder', remoteUri);
	} catch (error) {
		logger.error('Failed to rebuild and reopen in container', error);
		await vscode.window.showErrorMessage(
			vscode.l10n.t('Failed to rebuild dev container: {0}', error instanceof Error ? error.message : String(error))
		);
	}
}

/**
 * Rebuild (without cache) and reopen the current workspace in a dev container
 */
export async function rebuildNoCacheAndReopenInContainer(): Promise<void> {
	const logger = getLogger();
	logger.debug('Command: rebuildNoCacheAndReopenInContainer');

	try {
		// Get current workspace folder
		const workspaceFolder = Workspace.getCurrentWorkspaceFolder();
		if (!workspaceFolder) {
			await vscode.window.showErrorMessage(vscode.l10n.t('No workspace folder is open'));
			return;
		}

		// Check if workspace has dev container configuration
		// Use async version to work with remote filesystems (inside containers)
		if (!await Workspace.hasDevContainerAsync(workspaceFolder)) {
			await vscode.window.showErrorMessage(
				vscode.l10n.t('No dev container configuration found. Create a .devcontainer/devcontainer.json or .devcontainer.json file first.')
			);
			return;
		}

		// Confirm rebuild action (no cache is more expensive)
		const confirm = await positron.window.showSimpleModalDialogPrompt(
			vscode.l10n.t('Rebuild Container Without Cache'),
			vscode.l10n.t('This will rebuild the container without cache and may take a long time. Continue?'),
			vscode.l10n.t('Rebuild'),
			vscode.l10n.t('Cancel')
		);

		if (!confirm) {
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
		// Extract just the folder name from the remote workspace path
		const workspaceName = result.remoteWorkspaceFolder.split('/').filter(s => s).pop();
		const authority = encodeDevContainerAuthority(result.containerId, workspaceName);
		const remoteUri = vscode.Uri.parse(`vscode-remote://${authority}${result.remoteWorkspaceFolder}`);

		logger.info(`Reloading window with authority: ${authority}`);

		// Reload window with the remote authority
		await vscode.commands.executeCommand('vscode.openFolder', remoteUri);
	} catch (error) {
		logger.error('Failed to rebuild (no cache) and reopen in container', error);
		await vscode.window.showErrorMessage(
			vscode.l10n.t('Failed to rebuild dev container: {0}', error instanceof Error ? error.message : String(error))
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
	logger.debug('Command: rebuildContainer');

	try {
		// Check if in a dev container
		if (!Workspace.isInDevContainer()) {
			await vscode.window.showErrorMessage(vscode.l10n.t('You are not currently in a dev container'));
			return;
		}

		// Get current workspace folder and remote workspace path
		const workspaceFolder = Workspace.getCurrentWorkspaceFolder();
		if (!workspaceFolder) {
			await vscode.window.showErrorMessage(vscode.l10n.t('No workspace folder is open'));
			return;
		}

		const remoteWorkspaceFolder = workspaceFolder.uri.fsPath;

		// Extract container identifier from remote authority
		const authority = workspaceFolder.uri.authority;
		if (!authority) {
			await vscode.window.showErrorMessage(vscode.l10n.t('Cannot determine container ID'));
			return;
		}

		// Decode authority to get identifier (may be workspace name or container ID)
		const decoded = decodeDevContainerAuthority(authority);
		if (!decoded) {
			await vscode.window.showErrorMessage(vscode.l10n.t('Cannot decode container authority'));
			return;
		}
		const identifier = decoded.containerId; // May be workspace name like "js-devc"

		logger.trace(`Authority identifier: ${identifier}`);
		logger.trace(`Remote name: ${vscode.env.remoteName}`);
		logger.trace(`Extension context: ${context.extensionMode === vscode.ExtensionMode.Production ? 'production' : 'development'}`);

		// Resolve workspace name to actual container ID and get local workspace path
		const resolved = resolveContainerIdentifier(identifier, logger);
		const containerId = resolved.containerId;
		let localWorkspaceFolder = resolved.localWorkspacePath;

		// Fallback 1: Try environment variables (legacy support)
		if (!localWorkspaceFolder) {
			localWorkspaceFolder = process.env.LOCAL_WORKSPACE_FOLDER;
			if (localWorkspaceFolder) {
				logger.debug(`Found local workspace path from env var: ${localWorkspaceFolder}`);
			}
		}

		if (!localWorkspaceFolder) {
			await vscode.window.showErrorMessage(
				vscode.l10n.t('Cannot determine local workspace folder. Please reopen the container.')
			);
			return;
		}

		// Confirm rebuild action
		const confirm = await positron.window.showSimpleModalDialogPrompt(
			vscode.l10n.t('Rebuild Container'),
			vscode.l10n.t('This will rebuild the container and reload the window. Continue?'),
			vscode.l10n.t('Rebuild'),
			vscode.l10n.t('Cancel')
		);

		if (!confirm) {
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
			vscode.l10n.t('Failed to initiate rebuild: {0}', error instanceof Error ? error.message : String(error))
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
	logger.debug('Command: rebuildContainerNoCache');

	try {
		// Check if in a dev container
		if (!Workspace.isInDevContainer()) {
			await vscode.window.showErrorMessage(vscode.l10n.t('You are not currently in a dev container'));
			return;
		}

		// Get current workspace folder and remote workspace path
		const workspaceFolder = Workspace.getCurrentWorkspaceFolder();
		if (!workspaceFolder) {
			await vscode.window.showErrorMessage(vscode.l10n.t('No workspace folder is open'));
			return;
		}

		const remoteWorkspaceFolder = workspaceFolder.uri.fsPath;

		// Extract container identifier from remote authority
		const authority = workspaceFolder.uri.authority;
		if (!authority) {
			await vscode.window.showErrorMessage(vscode.l10n.t('Cannot determine container ID'));
			return;
		}

		// Decode authority to get identifier (may be workspace name or container ID)
		const decoded = decodeDevContainerAuthority(authority);
		if (!decoded) {
			await vscode.window.showErrorMessage(vscode.l10n.t('Cannot decode container authority'));
			return;
		}
		const identifier = decoded.containerId; // May be workspace name like "js-devc"

		logger.trace(`Authority identifier: ${identifier}`);
		logger.trace(`Remote name: ${vscode.env.remoteName}`);

		// Resolve workspace name to actual container ID and get local workspace path
		const resolved = resolveContainerIdentifier(identifier, logger);
		const containerId = resolved.containerId;
		let localWorkspaceFolder = resolved.localWorkspacePath;

		// Fallback: Try environment variables (legacy support)
		if (!localWorkspaceFolder) {
			localWorkspaceFolder = process.env.LOCAL_WORKSPACE_FOLDER;
			if (localWorkspaceFolder) {
				logger.debug(`Found local workspace path from env var: ${localWorkspaceFolder}`);
			}
		}

		if (!localWorkspaceFolder) {
			await vscode.window.showErrorMessage(
				vscode.l10n.t('Cannot determine local workspace folder. Please reopen the container.')
			);
			return;
		}

		// Confirm rebuild action
		const confirm = await positron.window.showSimpleModalDialogPrompt(
			vscode.l10n.t('Rebuild Container Without Cache'),
			vscode.l10n.t('This will rebuild the container without cache and reload the window. This may take a long time. Continue?'),
			vscode.l10n.t('Rebuild'),
			vscode.l10n.t('Cancel')
		);

		if (!confirm) {
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
			vscode.l10n.t('Failed to initiate rebuild: {0}', error instanceof Error ? error.message : String(error))
		);
	}
}

/**
 * Helper function to resolve a workspace name or identifier to a container ID
 */
function resolveContainerIdentifier(identifier: string, logger: any): { containerId: string; localWorkspacePath: string | undefined } {
	let containerId: string = identifier;
	let localWorkspaceFolder: string | undefined;

	try {
		const storage = WorkspaceMappingStorage.getInstance();
		logger.trace(`Storage instance retrieved, checking for identifier ${identifier}`);

		const allMappings = storage.getAll();
		logger.trace(`Total mappings in storage: ${allMappings.length}`);
		allMappings.forEach(m => {
			logger.trace(`  Mapping: ${m.containerId} -> ${m.localWorkspacePath} (remote: ${m.remoteWorkspacePath})`);
		});

		// First try direct lookup (if identifier is already a container ID)
		let mapping = storage.get(identifier);

		// If not found, try to resolve workspace name to container ID
		if (!mapping) {
			logger.trace(`No direct mapping found, trying to resolve workspace name to container ID`);
			for (const [cid, m] of storage.entries()) {
				if (m.remoteWorkspacePath) {
					const workspaceName = m.remoteWorkspacePath.split('/').filter(s => s).pop();
					if (workspaceName === identifier) {
						logger.debug(`Resolved workspace name "${identifier}" to container ${cid}`);
						containerId = cid;
						mapping = m;
						break;
					}
				}
			}
		}

		if (mapping?.localWorkspacePath) {
			localWorkspaceFolder = mapping.localWorkspacePath;
			logger.debug(`Found local workspace path from storage: ${localWorkspaceFolder}`);
		} else {
			logger.warn(`No mapping found for identifier ${identifier} in storage`);
		}
	} catch (error) {
		logger.error('Failed to get workspace mapping from storage', error);
	}

	return { containerId, localWorkspacePath: localWorkspaceFolder };
}

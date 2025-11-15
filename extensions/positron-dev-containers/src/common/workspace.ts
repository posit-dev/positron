/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceFolderPaths } from './types';
import { getLogger } from './logger';

/**
 * Workspace utilities for dev containers
 */
export class Workspace {
	/**
	 * Check if the workspace has a dev container configuration
	 */
	static hasDevContainer(workspaceFolder?: vscode.WorkspaceFolder): boolean {
		if (!workspaceFolder) {
			// Check all workspace folders
			const folders = vscode.workspace.workspaceFolders;
			if (!folders || folders.length === 0) {
				return false;
			}
			return folders.some(folder => this.hasDevContainer(folder));
		}

		const paths = this.getDevContainerPaths(workspaceFolder);
		if (!paths) {
			return false;
		}

		return fs.existsSync(paths.devContainerJsonPath);
	}

	/**
	 * Check if the workspace has a dev container configuration (async version using VS Code filesystem API)
	 * This works with remote filesystems (e.g., inside containers)
	 */
	static async hasDevContainerAsync(workspaceFolder?: vscode.WorkspaceFolder): Promise<boolean> {
		if (!workspaceFolder) {
			// Check all workspace folders
			const folders = vscode.workspace.workspaceFolders;
			if (!folders || folders.length === 0) {
				return false;
			}
			// Check folders sequentially to avoid race conditions
			for (const folder of folders) {
				if (await this.hasDevContainerAsync(folder)) {
					return true;
				}
			}
			return false;
		}

		const paths = await this.getDevContainerPathsAsync(workspaceFolder);
		return paths !== undefined;
	}

	/**
	 * Get all workspace folders that have dev container configurations
	 */
	static getWorkspaceFoldersWithDevContainers(): vscode.WorkspaceFolder[] {
		const folders = vscode.workspace.workspaceFolders;
		if (!folders) {
			return [];
		}

		return folders.filter(folder => this.hasDevContainer(folder));
	}

	/**
	 * Get the dev container paths for a workspace folder
	 */
	static getDevContainerPaths(workspaceFolder: vscode.WorkspaceFolder): WorkspaceFolderPaths | undefined {
		const workspacePath = workspaceFolder.uri.fsPath;

		// Check for .devcontainer/devcontainer.json
		const devContainerFolder = path.join(workspacePath, '.devcontainer');
		const devContainerJsonPath = path.join(devContainerFolder, 'devcontainer.json');

		if (fs.existsSync(devContainerJsonPath)) {
			return {
				workspaceFolder: workspacePath,
				devContainerFolder,
				devContainerJsonPath
			};
		}

		// Check for .devcontainer.json in workspace root
		const rootDevContainerJsonPath = path.join(workspacePath, '.devcontainer.json');
		if (fs.existsSync(rootDevContainerJsonPath)) {
			return {
				workspaceFolder: workspacePath,
				devContainerFolder: workspacePath,
				devContainerJsonPath: rootDevContainerJsonPath
			};
		}

		return undefined;
	}

	/**
	 * Get the dev container paths for a workspace folder (async version using VS Code filesystem API)
	 * This works with remote filesystems (e.g., inside containers)
	 */
	static async getDevContainerPathsAsync(workspaceFolder: vscode.WorkspaceFolder): Promise<WorkspaceFolderPaths | undefined> {
		const workspaceUri = workspaceFolder.uri;

		// Check for .devcontainer/devcontainer.json
		const devContainerFolderUri = vscode.Uri.joinPath(workspaceUri, '.devcontainer');
		const devContainerJsonUri = vscode.Uri.joinPath(devContainerFolderUri, 'devcontainer.json');

		try {
			await vscode.workspace.fs.stat(devContainerJsonUri);
			return {
				workspaceFolder: workspaceUri.fsPath,
				devContainerFolder: devContainerFolderUri.fsPath,
				devContainerJsonPath: devContainerJsonUri.fsPath
			};
		} catch {
			// File doesn't exist, try next location
		}

		// Check for .devcontainer.json in workspace root
		const rootDevContainerJsonUri = vscode.Uri.joinPath(workspaceUri, '.devcontainer.json');
		try {
			await vscode.workspace.fs.stat(rootDevContainerJsonUri);
			return {
				workspaceFolder: workspaceUri.fsPath,
				devContainerFolder: workspaceUri.fsPath,
				devContainerJsonPath: rootDevContainerJsonUri.fsPath
			};
		} catch {
			// File doesn't exist
		}

		return undefined;
	}

	/**
	 * Get the current workspace folder
	 */
	static getCurrentWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
		const folders = vscode.workspace.workspaceFolders;
		if (!folders || folders.length === 0) {
			return undefined;
		}

		// If there's only one folder, return it
		if (folders.length === 1) {
			return folders[0];
		}

		// If there's an active text editor, use its workspace folder
		const activeEditor = vscode.window.activeTextEditor;
		if (activeEditor) {
			const workspaceFolder = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri);
			if (workspaceFolder) {
				return workspaceFolder;
			}
		}

		// Default to first folder
		return folders[0];
	}

	/**
	 * Get the current workspace folder with dev container
	 */
	static getCurrentWorkspaceFolderWithDevContainer(): vscode.WorkspaceFolder | undefined {
		const currentFolder = this.getCurrentWorkspaceFolder();
		if (!currentFolder) {
			return undefined;
		}

		if (this.hasDevContainer(currentFolder)) {
			return currentFolder;
		}

		// Try to find any folder with dev container
		const foldersWithDevContainers = this.getWorkspaceFoldersWithDevContainers();
		if (foldersWithDevContainers.length > 0) {
			return foldersWithDevContainers[0];
		}

		return undefined;
	}

	/**
	 * Check if we're currently in a dev container
	 */
	static isInDevContainer(): boolean {
		const remoteName = vscode.env.remoteName;
		return remoteName === 'dev-container' || remoteName === 'attached-container';
	}

	/**
	 * Get the remote name
	 */
	static getRemoteName(): string | undefined {
		return vscode.env.remoteName;
	}

	/**
	 * Get the local workspace folder path when in a dev container
	 * Returns undefined if not in a dev container or path cannot be determined
	 */
	static async getLocalWorkspaceFolder(): Promise<string | undefined> {
		if (!this.isInDevContainer()) {
			return undefined;
		}

		// Extract container ID from workspace URI authority
		const currentFolder = this.getCurrentWorkspaceFolder();
		if (currentFolder && currentFolder.uri.authority) {
			const containerId = this.getContainerIdFromAuthority(currentFolder.uri.authority);
			if (containerId) {
				getLogger().debug(`Extracted container ID from authority: ${containerId}`);

				// Try WorkspaceMappingStorage first (fastest, most reliable)
				try {
					const { WorkspaceMappingStorage } = await import('./workspaceMappingStorage.js');
					const storage = WorkspaceMappingStorage.getInstance();
					const mapping = storage.get(containerId);
					if (mapping?.localWorkspacePath) {
						getLogger().info(`Retrieved local folder from storage: ${mapping.localWorkspacePath}`);
						return mapping.localWorkspacePath;
					}
				} catch (error) {
					getLogger().warn('Failed to get workspace mapping from storage', error);
				}

				// Fallback 1: Inspect container to get local folder from labels
				try {
					const { getDevContainerManager } = await import('../container/devContainerManager.js');
					const manager = getDevContainerManager();
					const containerDetails = await manager.inspectContainerDetails(containerId);

					const { ContainerLabels } = await import('../container/containerLabels.js');
					const localFolder = ContainerLabels.getLocalFolder(containerDetails.Config.Labels || {});

					if (localFolder) {
						getLogger().info(`Retrieved local folder from container labels: ${localFolder}`);
						return localFolder;
					}
				} catch (error) {
					getLogger().error('Failed to inspect container for local folder', error);
				}
			}
		}

		// Fallback 2: Try environment variables (legacy support)
		const containerWorkspaceFolder = process.env.CONTAINER_WORKSPACE_FOLDER;
		if (containerWorkspaceFolder) {
			return containerWorkspaceFolder;
		}

		const localWorkspaceFolder = process.env.LOCAL_WORKSPACE_FOLDER;
		if (localWorkspaceFolder) {
			return localWorkspaceFolder;
		}

		// Last resort fallback: return current workspace path with warning
		if (currentFolder) {
			getLogger().warn('Could not determine local workspace folder, using container path as fallback');
			return currentFolder.uri.fsPath;
		}

		return undefined;
	}

	/**
	 * Extract container ID from remote authority
	 * Authority format: dev-container+<containerId> or attached-container+<containerId>
	 */
	private static getContainerIdFromAuthority(authority: string): string | undefined {
		const match = authority.match(/^(?:dev-container|attached-container)\+(.+)$/);
		return match?.[1];
	}

	/**
	 * Pick a workspace folder with dev container
	 * Shows a quick pick if multiple folders exist
	 */
	static async pickWorkspaceFolderWithDevContainer(): Promise<vscode.WorkspaceFolder | undefined> {
		const foldersWithDevContainers = this.getWorkspaceFoldersWithDevContainers();

		if (foldersWithDevContainers.length === 0) {
			vscode.window.showErrorMessage(vscode.l10n.t('No workspace folders with dev container configuration found'));
			return undefined;
		}

		if (foldersWithDevContainers.length === 1) {
			return foldersWithDevContainers[0];
		}

		// Show quick pick
		const items = foldersWithDevContainers.map(folder => ({
			label: folder.name,
			description: folder.uri.fsPath,
			folder
		}));

		const selected = await vscode.window.showQuickPick(items, {
			placeHolder: vscode.l10n.t('Select a workspace folder to open in container')
		});

		return selected?.folder;
	}

	/**
	 * Ensure directory exists
	 */
	static ensureDirectoryExists(dirPath: string): void {
		if (!fs.existsSync(dirPath)) {
			fs.mkdirSync(dirPath, { recursive: true });
			getLogger().debug(`Created directory: ${dirPath}`);
		}
	}

	/**
	 * Read file content
	 */
	static readFile(filePath: string): string | undefined {
		try {
			if (fs.existsSync(filePath)) {
				return fs.readFileSync(filePath, 'utf-8');
			}
		} catch (error) {
			getLogger().error(`Failed to read file: ${filePath}`, error);
		}
		return undefined;
	}

	/**
	 * Write file content
	 */
	static writeFile(filePath: string, content: string): boolean {
		try {
			// Ensure parent directory exists
			const parentDir = path.dirname(filePath);
			this.ensureDirectoryExists(parentDir);

			fs.writeFileSync(filePath, content, 'utf-8');
			getLogger().debug(`Wrote file: ${filePath}`);
			return true;
		} catch (error) {
			getLogger().error(`Failed to write file: ${filePath}`, error);
			return false;
		}
	}

	/**
	 * Check if a file exists
	 */
	static fileExists(filePath: string): boolean {
		try {
			return fs.existsSync(filePath);
		} catch (error) {
			return false;
		}
	}
}

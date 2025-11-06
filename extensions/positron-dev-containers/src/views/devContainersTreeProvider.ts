/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import { getLogger } from '../common/logger';
import { getDevContainerManager } from '../container/devContainerManager';
import { DevContainerInfo } from '../common/types';

/**
 * Tree item for a dev container
 */
export class DevContainerTreeItem extends vscode.TreeItem {
	constructor(
		public readonly containerInfo: DevContainerInfo,
		public readonly localFolder: string | undefined
	) {
		// Use the folder name as the label
		const label = localFolder ? path.basename(localFolder) : containerInfo.containerName;

		super(label, vscode.TreeItemCollapsibleState.None);

		// Set the container name as description (detail text)
		this.description = containerInfo.containerName;

		// Set tooltip with more details
		this.tooltip = this.createTooltip();

		// Set icon based on container state
		this.iconPath = new vscode.ThemeIcon(
			containerInfo.state === 'running' ? 'vm-active' : 'vm-outline'
		);

		// Set context value for menu items
		// Use the same pattern as the existing targetsContainers view
		this.contextValue = containerInfo.state === 'running' ? 'runningDevContainer' : 'exitedDevContainer';

		// Make the item a command to open in current window on click
		this.command = {
			command: 'remote-containers.attachToContainerInCurrentWindow',
			title: 'Open Container',
			arguments: [this]
		};
	}

	private createTooltip(): string {
		const parts = [
			`Container: ${this.containerInfo.containerName}`,
			`State: ${this.containerInfo.state}`,
		];

		if (this.localFolder) {
			parts.push(`Folder: ${this.localFolder}`);
		}

		if (this.containerInfo.containerId) {
			parts.push(`ID: ${this.containerInfo.containerId.substring(0, 12)}`);
		}

		return parts.join('\n');
	}
}

/**
 * Tree data provider for dev containers
 */
export class DevContainersTreeProvider implements vscode.TreeDataProvider<DevContainerTreeItem> {
	private _onDidChangeTreeData = new vscode.EventEmitter<DevContainerTreeItem | undefined | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private containers: DevContainerInfo[] = [];
	private isLoading = false;

	constructor() {
		// Initial load
		this.refresh();
	}

	/**
	 * Refresh the tree view
	 */
	async refresh(): Promise<void> {
		const logger = getLogger();

		// Prevent concurrent refreshes
		if (this.isLoading) {
			logger.debug('Tree refresh already in progress, skipping...');
			return;
		}

		this.isLoading = true;

		try {
			logger.debug('Refreshing dev containers tree view');
			const manager = getDevContainerManager();

			// Check if Docker is available
			const dockerAvailable = await manager.isDockerAvailable();
			if (!dockerAvailable) {
				logger.warn('Docker is not available');
				this.containers = [];
				this._onDidChangeTreeData.fire();
				return;
			}

			// Get all dev containers
			this.containers = await manager.listDevContainers();
			logger.debug(`Found ${this.containers.length} dev containers`);

			// Fire change event to update the view
			this._onDidChangeTreeData.fire();
		} catch (error) {
			logger.error('Failed to refresh dev containers tree', error);
			this.containers = [];
			this._onDidChangeTreeData.fire();
		} finally {
			this.isLoading = false;
		}
	}

	/**
	 * Get tree item
	 */
	getTreeItem(element: DevContainerTreeItem): vscode.TreeItem {
		return element;
	}

	/**
	 * Get children (root level only)
	 */
	async getChildren(element?: DevContainerTreeItem): Promise<DevContainerTreeItem[]> {
		const logger = getLogger();

		// Only root level - no children
		if (element) {
			return [];
		}

		// If no containers, show empty
		if (this.containers.length === 0) {
			logger.debug('No dev containers to display');
			return [];
		}

		// Convert containers to tree items
		const items: DevContainerTreeItem[] = [];

		for (const container of this.containers) {
			try {
				// Use the workspace folder from the container info (already extracted from labels)
				items.push(new DevContainerTreeItem(container, container.workspaceFolder));
			} catch (error) {
				logger.error(`Failed to create tree item for container ${container.containerId}`, error);
			}
		}

		// Sort by folder name (label)
		items.sort((a, b) => {
			const labelA = a.label?.toString() || '';
			const labelB = b.label?.toString() || '';
			return labelA.localeCompare(labelB);
		});

		return items;
	}

	/**
	 * Get parent (always null for flat list)
	 */
	getParent(): vscode.ProviderResult<DevContainerTreeItem> {
		return null;
	}
}

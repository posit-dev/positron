/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getLogger } from './logger';

/**
 * Pending rebuild request
 */
export interface PendingRebuild {
	/**
	 * Local workspace folder path to rebuild
	 */
	workspaceFolder: string;

	/**
	 * Container ID being rebuilt
	 */
	containerId: string;

	/**
	 * Remote workspace folder path in the container
	 */
	remoteWorkspaceFolder: string;

	/**
	 * Whether to skip cache during rebuild
	 */
	noCache: boolean;

	/**
	 * Timestamp when rebuild was requested
	 */
	requestedAt: number;
}

const PENDING_REBUILD_KEY = 'positron-dev-containers.pendingRebuild';

/**
 * Manages pending rebuild state across window reloads
 */
export class RebuildStateManager {
	private context: vscode.ExtensionContext;

	constructor(context: vscode.ExtensionContext) {
		this.context = context;
	}

	/**
	 * Store a pending rebuild request
	 */
	async setPendingRebuild(rebuild: PendingRebuild): Promise<void> {
		const logger = getLogger();
		logger.debug(`Storing pending rebuild for: ${rebuild.workspaceFolder}`);
		await this.context.globalState.update(PENDING_REBUILD_KEY, rebuild);
	}

	/**
	 * Get pending rebuild request
	 */
	getPendingRebuild(): PendingRebuild | undefined {
		return this.context.globalState.get<PendingRebuild>(PENDING_REBUILD_KEY);
	}

	/**
	 * Clear pending rebuild request
	 */
	async clearPendingRebuild(): Promise<void> {
		const logger = getLogger();
		logger.debug('Clearing pending rebuild state');
		await this.context.globalState.update(PENDING_REBUILD_KEY, undefined);
	}

	/**
	 * Check if there's a pending rebuild that matches the current workspace
	 */
	hasPendingRebuildForWorkspace(workspacePath: string): boolean {
		const pending = this.getPendingRebuild();
		return pending?.workspaceFolder === workspacePath;
	}
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Workspace } from '../common/workspace';
import { getLogger } from '../common/logger';

/**
 * Storage keys for dev container notification preferences
 */
const GLOBAL_DONT_SHOW_KEY = 'positron-dev-containers.dontShowDevContainerNotification';
const WORKSPACE_DONT_SHOW_KEY = 'dontShowDevContainerNotification';

/**
 * Check and show dev container detection notification if needed
 */
export async function checkAndShowDevContainerNotification(context: vscode.ExtensionContext): Promise<void> {
	const logger = getLogger();

	// Don't show if we're already in a dev container
	if (Workspace.isInDevContainer()) {
		logger.debug('Already in dev container, skipping notification');
		return;
	}

	// Check if workspace has dev container
	if (!Workspace.hasDevContainer()) {
		logger.debug('No dev container configuration found, skipping notification');
		return;
	}

	// Check if user has opted out globally
	const globalDontShow = context.globalState.get<boolean>(GLOBAL_DONT_SHOW_KEY, false);
	if (globalDontShow) {
		logger.debug('User has opted out of dev container notifications globally');
		return;
	}

	// Check if user has opted out for this workspace
	const workspaceFolder = Workspace.getCurrentWorkspaceFolder();
	if (workspaceFolder) {
		const workspaceDontShow = context.workspaceState.get<boolean>(
			`${WORKSPACE_DONT_SHOW_KEY}.${workspaceFolder.uri.toString()}`,
			false
		);
		if (workspaceDontShow) {
			logger.debug(`User has opted out of dev container notifications for this workspace: ${workspaceFolder.name}`);
			return;
		}
	}

	// Show the notification
	await showDevContainerNotification(context, workspaceFolder);
}

/**
 * Show the dev container detection notification
 */
async function showDevContainerNotification(
	context: vscode.ExtensionContext,
	workspaceFolder: vscode.WorkspaceFolder | undefined
): Promise<void> {
	const logger = getLogger();

	logger.debug('Showing dev container detection notification');

	const message = 'Folder contains a Dev Container configuration file. Reopen folder to develop in a container?';
	const reopenButton = 'Reopen in Container';
	const dontShowButton = 'Don\'t Show Again...';

	const result = await vscode.window.showInformationMessage(
		message,
		reopenButton,
		dontShowButton
	);

	if (result === reopenButton) {
		logger.debug('User clicked "Reopen in Container"');
		await vscode.commands.executeCommand('remote-containers.reopenInContainer');
	} else if (result === dontShowButton) {
		logger.debug('User clicked "Don\'t Show Again..."');
		await handleDontShowAgain(context, workspaceFolder);
	}
}

/**
 * Handle "Don't Show Again" button click
 */
async function handleDontShowAgain(
	context: vscode.ExtensionContext,
	workspaceFolder: vscode.WorkspaceFolder | undefined
): Promise<void> {
	const logger = getLogger();

	// Ask user about the scope
	const currentFolderOption = 'Current Folder Only';
	const allFoldersOption = 'All Folders';

	const scope = await vscode.window.showQuickPick(
		[currentFolderOption, allFoldersOption],
		{
			placeHolder: 'Don\'t show dev container notification for...'
		}
	);

	if (!scope) {
		logger.debug('User cancelled "Don\'t Show Again" scope selection');
		return;
	}

	if (scope === allFoldersOption) {
		// Store in global state
		await context.globalState.update(GLOBAL_DONT_SHOW_KEY, true);
		logger.debug('User opted out of dev container notifications globally');
		await vscode.window.showInformationMessage(
			'Dev container notifications will not be shown for any folder.'
		);
	} else if (scope === currentFolderOption && workspaceFolder) {
		// Store in workspace state
		await context.workspaceState.update(
			`${WORKSPACE_DONT_SHOW_KEY}.${workspaceFolder.uri.toString()}`,
			true
		);
		logger.debug(`User opted out of dev container notifications for workspace: ${workspaceFolder.name}`);
		await vscode.window.showInformationMessage(
			`Dev container notifications will not be shown for ${workspaceFolder.name}.`
		);
	} else if (scope === currentFolderOption && !workspaceFolder) {
		logger.error('Cannot store workspace preference: no workspace folder found');
		await vscode.window.showErrorMessage(
			'Cannot disable notifications for current folder: no workspace folder found.'
		);
	}
}

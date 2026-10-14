/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { CAN_CREATE_FOLDER_IN_COMMAND, canCreateFolderIn } from './canCreateFolder';

const CONFIG_SECTION = 'fileTransfer';
const SHOW_NOTIFICATIONS_KEY = 'showNotifications';

function notificationsEnabled(): boolean {
	return vscode.workspace.getConfiguration(CONFIG_SECTION).get<boolean>(SHOW_NOTIFICATIONS_KEY, true);
}

export function activate(context: vscode.ExtensionContext) {
	// Used by the New Folder dialogs, which run in the renderer and cannot ask the operating
	// system whether the user can write to a folder. In a remote window this runs in the remote
	// extension host, which receives the renderer's vscode-remote URIs as file URIs (see
	// createURITransformer), so any other scheme is one this host cannot check.
	context.subscriptions.push(vscode.commands.registerCommand(
		CAN_CREATE_FOLDER_IN_COMMAND,
		(parent: vscode.Uri) => parent.scheme === 'file' ? canCreateFolderIn(parent.fsPath) : undefined
	));

	context.subscriptions.push(positron.window.onDidUploadFile(uri => {
		if (!notificationsEnabled()) {
			return;
		}
		vscode.window.showInformationMessage(
			vscode.l10n.t('{0} upload complete', path.basename(uri.path))
		);
	}));

	context.subscriptions.push(positron.window.onDidDownloadFile(uri => {
		if (!notificationsEnabled()) {
			return;
		}
		vscode.window.showInformationMessage(
			vscode.l10n.t('{0} download complete', path.basename(uri.path))
		);
	}));
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as positron from 'positron';
import * as vscode from 'vscode';

const CONFIG_SECTION = 'fileTransfer';
const SHOW_NOTIFICATIONS_KEY = 'showNotifications';

function notificationsEnabled(): boolean {
	return vscode.workspace.getConfiguration(CONFIG_SECTION).get<boolean>(SHOW_NOTIFICATIONS_KEY, true);
}

export function activate(context: vscode.ExtensionContext) {
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

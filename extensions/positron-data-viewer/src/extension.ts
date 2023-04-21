/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { createDataPanel } from './dataPanel';

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand('positron.openDataViewer', async () => {
			createDataPanel(context);
		}));

	context.subscriptions.push(
		positron.runtime.registerClientHandler({
			clientType: 'positron.dataViewer',
			callback: (client, params) => {
				createDataPanel(context);
				return true;
			}
		}));
}

export function deactivate() {
}

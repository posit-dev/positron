/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand('positron.openDataViewer', () => {
			const panel = vscode.window.createWebviewPanel(
				'positronDataViewer',
				'Data Viewer',
				vscode.ViewColumn.One,
				{}
			);

			panel.webview.html = `Hello, World!`;
		})
	);
}

export function deactivate() {
}

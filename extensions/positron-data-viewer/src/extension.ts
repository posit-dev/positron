/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand('positron.openDataViewer', () => {
			const panel = vscode.window.createWebviewPanel(
				'positronDataViewer',
				'Data Viewer',
				vscode.ViewColumn.One,
				{}
			);

			const reactPath = vscode.Uri.file(
				path.join(context.extensionPath, 'viewer', 'viewer.js')
			);
			const reactUri = reactPath.with({ scheme: 'vscode-resource' });

			const reactHtml = `<script src="${reactUri}">`;
			panel.webview.html = `<body><div id="root"></div></body>${reactHtml}`;
		})
	);
}

export function deactivate() {
}

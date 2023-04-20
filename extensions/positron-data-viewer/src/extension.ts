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
				{
					enableScripts: true,
				}
			);

			let reactPath = vscode.Uri.file(
				path.join(context.extensionPath, 'ui', 'node_modules', 'react', 'umd', 'react.development.js')
			);
			let reactUri = panel.webview.asWebviewUri(reactPath);
			let reactHtml = `<script src="${reactUri}"></script>\n`;

			reactPath = vscode.Uri.file(
				path.join(context.extensionPath, 'ui', 'node_modules', 'react-dom', 'umd', 'react-dom.development.js')
			);
			reactUri = panel.webview.asWebviewUri(reactPath);
			reactHtml += `<script src="${reactUri}"></script>\n`;

			reactPath = vscode.Uri.file(
				path.join(context.extensionPath, 'ui', 'out', 'index.js')
			);
			reactUri = panel.webview.asWebviewUri(reactPath);
			reactHtml += `<script src="${reactUri}"></script>\n`;

			panel.webview.html = `<body><div id="root"></div></body>${reactHtml}`;
		})
	);
}

export function deactivate() {
}

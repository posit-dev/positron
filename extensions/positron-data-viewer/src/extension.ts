/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand('positron.openDataViewer', async () => {
			const panel = vscode.window.createWebviewPanel(
				'positronDataViewer',
				'Data Viewer',
				vscode.ViewColumn.One,
				{
					enableScripts: true,
				}
			);

			// Check for the node_modules folder in the extension directory
			const nodeFolder = path.join(context.extensionPath, 'ui', 'node_modules');
			const developmentMode = await vscode.workspace.fs.stat(vscode.Uri.file(nodeFolder));
			const scriptPaths = [];

			if (developmentMode) {
				// In development mode, we use the React and ReactDOM libraries
				// from the extension folder directly. In production mode,
				// webpack bundles these libraries into the index.js file.
				scriptPaths.push(path.join(nodeFolder,
					'react', 'umd', 'react.development.js'));
				scriptPaths.push(path.join(nodeFolder,
					'react-dom', 'umd', 'react-dom.development.js'));
			}

			// Add the main index.js file
			scriptPaths.push(path.join(context.extensionPath,
				'ui', 'out', 'index.js'));

			// Convert each script path to a webview URI
			const reactHtml = scriptPaths.map((scriptPath) => {
				const scriptUri = panel.webview.asWebviewUri(vscode.Uri.file(scriptPath));
				return `<script src="${scriptUri}"></script>`;
			}).join('\n');

			panel.webview.html = `<body><div id="root"></div></body>${reactHtml}`;
		})
	);
}

export function deactivate() {
}

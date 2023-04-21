/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import path = require('path');
import * as vscode from 'vscode';
import * as positron from 'positron';

export async function createDataPanel(context: vscode.ExtensionContext,
	client: positron.RuntimeClientInstance,
	initialData: any) {
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

	// Convert each script path to a webview URI
	const reactHtml = scriptPaths.map((scriptPath) => {
		const scriptUri = panel.webview.asWebviewUri(vscode.Uri.file(scriptPath));
		return `<script src="${scriptUri}"></script>`;
	}).join('\n');

	// Add the main index.js file
	const appPath = path.join(context.extensionPath, 'ui', 'out', 'app.js');
	const appUri = panel.webview.asWebviewUri(vscode.Uri.file(appPath));
	const appHtml = `<script type="module" src="${appUri}"></script>`;

	// Send events from the client to the webview
	client.onDidSendEvent((event) => {
		panel.webview.postMessage(event);
	});

	// Handle messages from the webview
	panel.webview.onDidReceiveMessage((message) => {
		if (message.msg_type === 'ready') {
			// The webview is ready to receive messages
			panel.webview.postMessage({
				msg_type: 'init',
				data: initialData
			});
		}
	});

	panel.webview.html = `<body><div id="root"></div></body>${reactHtml}${appHtml}`;
}

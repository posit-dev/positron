/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import path = require('path');
import * as vscode from 'vscode';
import * as positron from 'positron';

/**
 * Creates the WebView panel containing the data viewer.
 *
 * @param context The extension context
 * @param client The runtime client instance; a two-way channel that allows the
 *   extension to communicate with the runtime
 * @param initialData The initial data to display in the data viewer
 */
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

	// Check for the node_modules folder in the extension directory; this only exists in
	// development mode. If it exists, we load the React and ReactDOM libraries from the
	// extension directory.
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

	// Get a list of all the script files in the extension's ui/out folder and
	// add them to the list of scripts to load in the webview
	const outFolder = path.join(context.extensionPath, 'ui', 'out');
	const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(outFolder));
	files.forEach((file) => {
		// If this file is a JavaScript file, add it to the list of scripts
		if (file[1] === vscode.FileType.File && file[0].endsWith('.js')) {
			scriptPaths.push(path.join(outFolder, file[0]));
		}
	});

	// Convert each script path to a webview URI
	const reactHtml = scriptPaths.map((scriptPath) => {
		const scriptUri = panel.webview.asWebviewUri(vscode.Uri.file(scriptPath));
		// Add the type="module" attribute to the script tag if the script is
		// not in the node_modules folder (i.e. it's one of our own scripts)
		const moduleAttribute = scriptPath.includes('node_modules') ? '' : 'type="module"';
		return `<script ${moduleAttribute} src="${scriptUri}"></script>`;
	}).join('\n');

	// Send events from the client to the webview
	client.onDidSendEvent((event) => {
		panel.webview.postMessage(event);
	});

	panel.title = initialData.title;

	// Set the HTML content of the webview
	panel.webview.html = `
		<head>
			<meta charset="UTF-8">
			<title>${initialData.title}</title>
		</head>
		<body>
			<div id="root"></div>
		</body>${reactHtml}$`;

	// Handle messages from the webview
	panel.webview.onDidReceiveMessage((message) => {
		console.log('Received message from webview: ', message);
		if (message.msg_type === 'ready') {
			// The webview is ready to receive messages; send it
			// the initial data
			panel.webview.postMessage({
				msg_type: 'data',
				data: initialData.columns
			});
		}
	},
		undefined,
		context.subscriptions);

	// When the panel is closed, dispose of the client
	panel.onDidDispose(() => {
		client.dispose();
	});
}

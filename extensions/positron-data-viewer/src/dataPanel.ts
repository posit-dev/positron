/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import path = require('path');
import * as vscode from 'vscode';
import * as positron from 'positron';
import { DataSet, DataViewerMessage, DataViewerMessageData } from './positron-data-viewer';

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
	initialData: DataSet) {
	const panel = vscode.window.createWebviewPanel(
		'positronDataViewer',
		'Data Viewer',
		vscode.ViewColumn.One,
		{
			enableScripts: true,
		}
	);

	// Check for the 'dist' folder in the extension directory; this only exists in
	// production mode.
	const distFolder = path.join(context.extensionPath, 'ui', 'dist');
	const fs = require('fs');
	const productionMode = fs.existsSync(distFolder);

	const scriptPaths = [];

	if (!productionMode) {
		const nodeFolder = path.join(context.extensionPath, 'ui', 'node_modules');
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
	const outFolder = path.join(context.extensionPath, 'ui', productionMode ? 'dist' : 'out');
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

	// In development mode, load the CSS file directly from the extension folder
	let cssTag = '';
	if (!productionMode) {
		const cssUri = vscode.Uri.file(path.join(context.extensionPath, 'ui', 'src', 'DataPanel.css'));
		const cssWebviewUri = panel.webview.asWebviewUri(cssUri);
		cssTag = `<link rel="stylesheet" href="${cssWebviewUri}">`;
	}

	// Set the HTML content of the webview
	panel.webview.html = `
		<head>
			<meta charset="UTF-8">
			<title>${initialData.title}</title>
			${cssTag}
		</head>
		<body>
			<div id="root"></div>
		</body>${reactHtml}`;

	// Handle messages from the webview
	panel.webview.onDidReceiveMessage((message: DataViewerMessage) => {
		if (message.msg_type === 'ready') {
			// The webview is ready to receive messages; send it
			// the initial data
			const dataMsg: DataViewerMessageData = {
				msg_type: 'data',
				data: initialData.columns
			};
			panel.webview.postMessage(dataMsg);
		}
	},
		undefined,
		context.subscriptions);

	// When the panel is closed, dispose of the client
	panel.onDidDispose(() => {
		client.dispose();
	});
}

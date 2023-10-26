/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import path = require('path');
import * as vscode from 'vscode';
import * as positron from 'positron';
import { DataSet, DataViewerMessage, DataViewerMessageRowResponse } from './positron-data-viewer';

/**
 * Creates the WebView panel containing the data viewer.
 *
 * @param context The extension context
 * @param client The runtime client instance; a two-way channel that allows the
 *   extension to communicate with the runtime
 * @param data Data from the `comm_open` containing the dataset title
 */
export async function createDataPanel(context: vscode.ExtensionContext,
	client: positron.RuntimeClientInstance,
	data: DataSet) {
	const panel = vscode.window.createWebviewPanel(
		'positronDataViewer',
		'Data Viewer',
		vscode.ViewColumn.One,
		{
			enableScripts: true,
		}
	);

	// Check for the 'ui/dist/index.js' file in the extension directory;
	// In dev mode this is written to 'ui/out/index.js' instead of 'ui/dist'
	const indexJs = path.join(context.extensionPath, 'ui', 'dist', 'index.js');
	const fs = require('fs');
	const productionMode = fs.existsSync(indexJs);

	// Get a list of all the script files in the extension's ui/out or ui/dist folder and
	// add them to the list of scripts to load in the webview
	const scriptPaths: string[] = [];
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
		// not in the node_modules folder (i.e. it's one of our own scripts).
		//
		// The "module" attribute should also be added to scripts with ".mjs"
		// (module JavaScript) extensions.
		const moduleAttribute = (
			!scriptPath.includes('.mjs') &&
			scriptPath.includes('node_modules')) ?
			'' :
			'type="module"';
		return `<script ${moduleAttribute} src="${scriptUri}"></script>`;
	}).join('\n');

	// Send events from the client to the webview
	client.onDidSendEvent((event) => {
		panel.webview.postMessage(event);
	});

	panel.title = data.title;

	// Set the HTML content of the webview
	panel.webview.html = `
		<head>
			<meta charset="UTF-8">
			<title>${data.title}</title>
		</head>
		<body>
			<div id="root"></div>
		</body>${reactHtml}`;

	// Handle messages from the webview
	panel.webview.onDidReceiveMessage((message: DataViewerMessage) => {
		if (message.msg_type === 'ready' || message.msg_type === 'request_rows') {
			// The webview is requesting initial or incremental data;
			// perform rpc to get the data from the language runtime
			client.performRpc(message).then((response) => {
				panel.webview.postMessage(response as DataViewerMessageRowResponse);
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

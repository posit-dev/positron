/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { PdfHttpServer } from './pdfHttpServer';

/**
 * Generate a random nonce for CSP.
 */
function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

/**
 * Create the webview HTML for the PDF viewer.
 */
export async function createWebviewHtml(
	webview: vscode.Webview,
	httpServer: PdfHttpServer,
	pdfId: string
): Promise<string> {
	const nonce = getNonce();
	const cspSource = webview.cspSource;
	let serverUrl = await httpServer.getExternalUrl();

	// Remove trailing slash if present.
	if (serverUrl.endsWith('/')) {
		serverUrl = serverUrl.slice(0, -1);
	}

	console.log(`PDF Server URL: ${serverUrl}`);
	console.log(`PDF ID: ${pdfId}`);

	// Build CSP allowing localhost iframes with full PDF.js viewer resources.
	const csp = [
		`default-src 'none'`,
		`style-src ${cspSource} 'unsafe-inline' ${serverUrl} http://localhost:* http://127.0.0.1:*`,
		`script-src ${cspSource} 'nonce-${nonce}' ${serverUrl} http://localhost:* http://127.0.0.1:* 'unsafe-eval'`,
		`frame-src ${serverUrl} http://localhost:* http://127.0.0.1:*`,
		`img-src ${cspSource} data: ${serverUrl} http://localhost:* http://127.0.0.1:*`,
		`font-src ${cspSource} data: ${serverUrl} http://localhost:* http://127.0.0.1:*`,
		`worker-src ${cspSource} blob: ${serverUrl} http://localhost:* http://127.0.0.1:*`,
		`connect-src ${serverUrl} http://localhost:* http://127.0.0.1:*`
	].join('; ');

	// Build viewer URL - use the legacy PDF.js viewer.
	const pdfUrl = `${serverUrl}/pdf/${pdfId}`;
	const viewerUrl = `${serverUrl}/pdfjs/web/viewer.html?file=${encodeURIComponent(pdfUrl)}`;
	console.log(`Viewer URL: ${viewerUrl}`);

	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta http-equiv="Content-Security-Policy" content="${csp}">
	<style>
		body, html {
			margin: 0;
			padding: 0;
			width: 100%;
			height: 100%;
			overflow: hidden;
		}
		iframe {
			border: none;
			width: 100%;
			height: 100%;
			display: block;
		}
	</style>
</head>
<body>
	<iframe id="pdf-frame" src="${viewerUrl}"></iframe>
</body>
</html>`;
}

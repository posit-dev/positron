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
 * Get the PDF.js theme value based on VS Code's color theme.
 */
function getPdfJsTheme(): number {
	// Get the active color theme from VS Code.
	const activeColorTheme = vscode.window.activeColorTheme;

	// Map the active color theme to PDF.js theme values: 0 = auto, 1 = light, 2 = dark.
	if (activeColorTheme.kind === vscode.ColorThemeKind.Light || activeColorTheme.kind === vscode.ColorThemeKind.HighContrastLight) {
		return 1; // Light mode
	} else if (activeColorTheme.kind === vscode.ColorThemeKind.Dark || activeColorTheme.kind === vscode.ColorThemeKind.HighContrast) {
		return 2; // Dark mode
	}

	// Default to auto if for some reason we can't determine the theme.
	return 0; // Auto (fallback)
}

/**
 * Create the webview HTML for the PDF viewer.
 */
export async function createWebviewHtml(
	webview: vscode.Webview,
	httpServer: PdfHttpServer,
	pdfId: string
): Promise<string> {
	// Generate a nonce for CSP.
	const nonce = getNonce();

	// Get the CSP source for the webview and the server URL.
	const cspSource = webview.cspSource;
	let serverUrl = await httpServer.getExternalUrl();

	// Remove trailing slash if present.
	if (serverUrl.endsWith('/')) {
		serverUrl = serverUrl.slice(0, -1);
	}

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

	// Build viewer URL - use custom wrapper that sets theme preference.
	const pdfUrl = `${serverUrl}/pdf/${pdfId}`;
	const theme = getPdfJsTheme();
	const viewerUrl = `${serverUrl}/viewer?file=${encodeURIComponent(pdfUrl)}&theme=${theme}`;

	// Return the complete HTML for the webview, including the CSP and the iframe pointing to the viewer URL.
	// Also includes a script to forward keyboard events from the PDF viewer to VS Code's keybinding service.
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
	<script nonce="${nonce}">
		// Get VS Code API for messaging - this is provided by VS Code's webview infrastructure
		const vscode = acquireVsCodeApi();

		// Expected origin for messages from the PDF viewer iframe.
		// We validate this to prevent other frames from spoofing keyboard events.
		const expectedOrigin = new URL('${serverUrl}').origin;

		// Listen for keyboard events forwarded from the PDF.js viewer.
		// The keyboard-forwarder.js script in the PDF viewer posts messages
		// when specific shortcuts are pressed that should be handled by VS Code.
		window.addEventListener('message', function(event) {
			// Validate the message origin - only accept messages from our PDF server
			if (event.origin !== expectedOrigin) {
				return;
			}

			if (event.data && event.data.channel === 'pdf-keyboard-event') {
				const data = event.data.data;

				// Send the keyboard event to the extension, which will execute
				// the appropriate VS Code command
				vscode.postMessage({
					type: 'keyboard-shortcut',
					key: data.key,
					code: data.code,
					keyCode: data.keyCode,
					shiftKey: data.shiftKey,
					altKey: data.altKey,
					ctrlKey: data.ctrlKey,
					metaKey: data.metaKey
				});
			}
		});
	</script>
</body>
</html>`;
}

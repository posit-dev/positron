/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { PdfHttpServer } from './pdfHttpServer';
import { createWebviewHtml } from './pdfViewerWebview';

/**
 * Custom editor provider for PDF files using HTTP server.
 */
export class PdfServerProvider implements vscode.CustomReadonlyEditorProvider {
	public static readonly viewType = 'positronPdfServer.previewEditor';

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly httpServer: PdfHttpServer
	) { }

	/**
	 * Open a custom document.
	 */
	public async openCustomDocument(uri: vscode.Uri): Promise<vscode.CustomDocument> {
		return { uri, dispose: () => { } };
	}

	/**
	 * Resolve custom editor.
	 */
	public async resolveCustomEditor(
		document: vscode.CustomDocument,
		webviewPanel: vscode.WebviewPanel,
		_token: vscode.CancellationToken
	): Promise<void> {
		// Register PDF with server.
		const pdfId = this.httpServer.registerPdf(document.uri);

		// Configure webview.
		webviewPanel.webview.options = {
			enableScripts: true,
			localResourceRoots: [this.context.extensionUri]
		};

		// Generate and set webview HTML.
		webviewPanel.webview.html = await createWebviewHtml(
			webviewPanel.webview,
			this.httpServer,
			pdfId
		);

		// Cleanup on disposal.
		webviewPanel.onDidDispose(() => {
			this.httpServer.unregisterPdf(pdfId);
		});
	}
}

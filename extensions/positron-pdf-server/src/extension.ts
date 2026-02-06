/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { PdfHttpServer } from './pdfHttpServer';
import { PdfServerProvider } from './pdfServerProvider';

/**
 * Activate the extension.
 */
export function activate(context: vscode.ExtensionContext) {
	try {
		// Log activation start. This can help diagnose issues where the extension fails to activate.
		console.log('Activating positron-pdf-server extension');

		// Initialize the PDF HTTP server singleton.
		const httpServer = PdfHttpServer.getInstance();

		// Create the PDF server provider for the custom editor.
		const pdfServerProvider = new PdfServerProvider(context, httpServer);

		// Register the provider with VS Code.
		context.subscriptions.push(
			vscode.window.registerCustomEditorProvider(
				PdfServerProvider.viewType,
				pdfServerProvider,
				{
					supportsMultipleEditorsPerDocument: true,
					webviewOptions: {
						retainContextWhenHidden: true
					}
				}
			)
		);

		// Log successful activation.
		console.log('positron-pdf-server extension activated');
	} catch (error) {
		// Log the error and show a user-friendly message if activation fails.
		console.error('Failed to activate positron-pdf-server extension:', error);
		vscode.window.showErrorMessage(`PDF Server extension failed to activate: ${error}`);
		throw error;
	}
}

/**
 * Deactivate the extension.
 */
export function deactivate() {
	// Log deactivation. This can help diagnose issues where the extension fails to clean up resources.
	console.log('Deactivating positron-pdf-server extension');

	// Dispose of the PDF HTTP server.
	PdfHttpServer.dispose();
}

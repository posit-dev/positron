/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
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
		console.log('Activating positron-pdf-server extension');

		const httpServer = PdfHttpServer.getInstance();
		const provider = new PdfServerProvider(context, httpServer);

		context.subscriptions.push(
			vscode.window.registerCustomEditorProvider(
				PdfServerProvider.viewType,
				provider,
				{
					supportsMultipleEditorsPerDocument: true,
					webviewOptions: {
						retainContextWhenHidden: true
					}
				}
			)
		);

		console.log('positron-pdf-server extension activated');
	} catch (error) {
		console.error('Failed to activate positron-pdf-server extension:', error);
		vscode.window.showErrorMessage(`PDF Server extension failed to activate: ${error}`);
		throw error;
	}
}

/**
 * Deactivate the extension.
 */
export function deactivate() {
	console.log('Deactivating positron-pdf-server extension');
	PdfHttpServer.dispose();
}

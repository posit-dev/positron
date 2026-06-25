/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { PdfHttpServer } from './pdfHttpServer';
import { PdfServerProvider } from './pdfServerProvider';

/**
 * Get the PDF.js theme value based on Positron's color theme.
 */
function getThemeValue(): number {
	const activeColorTheme = vscode.window.activeColorTheme;
	if (activeColorTheme.kind === vscode.ColorThemeKind.Light || activeColorTheme.kind === vscode.ColorThemeKind.HighContrastLight) {
		return 1;
	} else if (activeColorTheme.kind === vscode.ColorThemeKind.Dark || activeColorTheme.kind === vscode.ColorThemeKind.HighContrast) {
		return 2;
	}
	return 0;
}

/**
 * Activate the extension.
 */
export function activate(context: vscode.ExtensionContext): void {
	try {
		// Initialize the PDF HTTP server singleton with the extension path.
		const httpServer = PdfHttpServer.getInstance();
		httpServer.initialize(context.extensionPath);

		// Create the PDF server provider for the custom editor.
		const pdfServerProvider = new PdfServerProvider(context, httpServer);

		// Register the provider with Positron.
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

		// Used by the notebook output system to render PDFs inline.
		context.subscriptions.push(
			vscode.commands.registerCommand('positron.pdfServer.getViewerUrl', async (fsPath: string): Promise<{ viewerUrl: string; pdfId: string }> => {
				const pdfUri = vscode.Uri.file(fsPath);
				const pdfId = httpServer.registerPdf(pdfUri);
				const serverUrl = (await httpServer.getExternalUrl()).replace(/\/$/, '');
				const pdfUrl = `${serverUrl}/pdf/${pdfId}`;
				const theme = getThemeValue();
				const viewerUrl = `${serverUrl}/pdfjs-notebook/web/viewer.html?file=${encodeURIComponent(pdfUrl)}&theme=${theme}`;
				return { viewerUrl, pdfId };
			})
		);

		// Used by the notebook output system to clean up PDF registrations on disposal.
		context.subscriptions.push(
			vscode.commands.registerCommand('positron.pdfServer.unregisterPdf', (pdfId: string) => {
				httpServer.unregisterPdf(pdfId);
			})
		);
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
	// Dispose of the PDF HTTP server.
	PdfHttpServer.dispose();
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { PdfHttpServer } from './pdfHttpServer';
import { PdfServerProvider } from './pdfServerProvider';

/**
 * Get the PDF.js theme value based on VS Code's color theme.
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
 * Public API surface for other extensions or the notebook output system.
 */
export interface PdfServerApi {
	registerPdf(pdfUri: vscode.Uri): string;
	unregisterPdf(pdfId: string): void;
	getExternalUrl(): Promise<string>;
}

/**
 * Activate the extension.
 */
export function activate(context: vscode.ExtensionContext): PdfServerApi {
	// Initialize the PDF HTTP server singleton with the extension path.
	const httpServer = PdfHttpServer.getInstance();
	httpServer.initialize(context.extensionPath);

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

	// Register a command to open a PDF in the viewer.
	context.subscriptions.push(
		vscode.commands.registerCommand('positron.pdfServer.openInViewer', (uriOrPath: vscode.Uri | string) => {
			const uri = typeof uriOrPath === 'string'
				? vscode.Uri.file(uriOrPath)
				: uriOrPath;
			vscode.commands.executeCommand('vscode.openWith', uri, PdfServerProvider.viewType);
		})
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

	// Return the public API.
	return {
		registerPdf: (pdfUri: vscode.Uri) => httpServer.registerPdf(pdfUri),
		unregisterPdf: (pdfId: string) => httpServer.unregisterPdf(pdfId),
		getExternalUrl: () => httpServer.getExternalUrl(),
	};
}

/**
 * Deactivate the extension.
 */
export function deactivate() {
	// Dispose of the PDF HTTP server.
	PdfHttpServer.dispose();
}

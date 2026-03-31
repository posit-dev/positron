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
	 * Map a keyboard shortcut to a VS Code command.
	 * Returns undefined if the shortcut doesn't map to a known command.
	 */
	private getCommandForShortcut(shortcut: {
		code: string;
		metaKey: boolean;
		ctrlKey: boolean;
		shiftKey: boolean;
		altKey: boolean;
	}): string | undefined {
		const isMac = process.platform === 'darwin';
		const cmdOrCtrl = isMac ? shortcut.metaKey : shortcut.ctrlKey;

		// Command Palette: Cmd/Ctrl+Shift+P
		if (cmdOrCtrl && shortcut.shiftKey && shortcut.code === 'KeyP') {
			return 'workbench.action.showCommands';
		}

		// Note: We intentionally do NOT handle Cmd/Ctrl+P (without shift) because
		// in a PDF context, users expect this to print the PDF, not open Quick Open.

		// Settings: Cmd/Ctrl+,
		if (cmdOrCtrl && shortcut.code === 'Comma') {
			return 'workbench.action.openSettings';
		}

		// Toggle Sidebar: Cmd/Ctrl+B
		if (cmdOrCtrl && shortcut.code === 'KeyB') {
			return 'workbench.action.toggleSidebarVisibility';
		}

		// Explorer: Cmd/Ctrl+Shift+E
		if (cmdOrCtrl && shortcut.shiftKey && shortcut.code === 'KeyE') {
			return 'workbench.view.explorer';
		}

		// Search: Cmd/Ctrl+Shift+F
		if (cmdOrCtrl && shortcut.shiftKey && shortcut.code === 'KeyF') {
			return 'workbench.action.findInFiles';
		}

		// Close Editor: Cmd/Ctrl+W
		if (cmdOrCtrl && shortcut.code === 'KeyW') {
			return 'workbench.action.closeActiveEditor';
		}

		// New Window: Cmd/Ctrl+Shift+N
		if (cmdOrCtrl && shortcut.shiftKey && shortcut.code === 'KeyN') {
			return 'workbench.action.newWindow';
		}

		// Escape - close panels/dialogs
		if (shortcut.code === 'Escape') {
			return 'workbench.action.closeQuickOpen';
		}

		// F1 - Help/Command Palette
		if (shortcut.code === 'F1') {
			return 'workbench.action.showCommands';
		}

		return undefined;
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

		// Listen for theme changes and reload the viewer.
		const themeChangeListener = vscode.window.onDidChangeActiveColorTheme(async () => {
			webviewPanel.webview.html = await createWebviewHtml(
				webviewPanel.webview,
				this.httpServer,
				pdfId
			);
		});

		// Listen for keyboard shortcut messages from the webview and execute
		// the appropriate VS Code commands. This allows shortcuts like
		// Cmd+Shift+P to work when the PDF viewer has focus.
		const messageListener = webviewPanel.webview.onDidReceiveMessage(async (message) => {
			if (message.type === 'keyboard-shortcut') {
				const command = this.getCommandForShortcut(message);
				if (command) {
					await vscode.commands.executeCommand(command);
				}
			}
		});

		// Cleanup on disposal.
		webviewPanel.onDidDispose(() => {
			// Dispose listeners.
			themeChangeListener.dispose();
			messageListener.dispose();

			// Unregister PDF from server.
			this.httpServer.unregisterPdf(pdfId);
		});
	}
}

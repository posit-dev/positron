/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';

/**
 * Custom editor provider for .RData files that loads the workspace
 * instead of opening for editing.
 */
export class RDataEditorProvider implements vscode.CustomReadonlyEditorProvider {

	public static readonly viewType = 'positron-r.rdataViewer';

	public static register(context: vscode.ExtensionContext): vscode.Disposable {
		const provider = new RDataEditorProvider(context);
		return vscode.window.registerCustomEditorProvider(
			RDataEditorProvider.viewType,
			provider,
			{
				webviewOptions: { retainContextWhenHidden: false },
				supportsMultipleEditorsPerDocument: false
			}
		);
	}

	constructor(private readonly context: vscode.ExtensionContext) { }

	async openCustomDocument(
		uri: vscode.Uri,
		_openContext: vscode.CustomDocumentOpenContext,
		_token: vscode.CancellationToken
	): Promise<vscode.CustomDocument> {
		return { uri, dispose: () => { } };
	}

	async resolveCustomEditor(
		document: vscode.CustomDocument,
		webviewPanel: vscode.WebviewPanel,
		_token: vscode.CancellationToken
	): Promise<void> {
		const filePath = document.uri.fsPath.replace(/\\/g, '/');
		const fileName = filePath.split('/').pop() || 'R workspace';

		// Show loading message in webview
		webviewPanel.webview.html = this.getLoadingHtml(fileName);

		// Execute the load command
		try {
			const command = `load(${JSON.stringify(filePath)})`;
			await positron.runtime.executeCode('r', command, true);

			// Update webview to show success
			webviewPanel.webview.html = this.getSuccessHtml(fileName);

			// Optionally close the editor after a delay
			// setTimeout(() => webviewPanel.dispose(), 2000);
		} catch (error) {
			webviewPanel.webview.html = this.getErrorHtml(fileName, error);
		}
	}

	private getLoadingHtml(fileName: string): string {
		return `<!DOCTYPE html>
<html>
<head>
	<style>
		body {
			font-family: var(--vscode-font-family);
			padding: 20px;
			color: var(--vscode-foreground);
		}
	</style>
</head>
<body>
	<h2>Loading R Workspace</h2>
	<p>Loading objects from <code>${this.escapeHtml(fileName)}</code>...</p>
</body>
</html>`;
	}

	private getSuccessHtml(fileName: string): string {
		return `<!DOCTYPE html>
<html>
<head>
	<style>
		body {
			font-family: var(--vscode-font-family);
			padding: 20px;
			color: var(--vscode-foreground);
		}
		.success { color: var(--vscode-testing-iconPassed); }
	</style>
</head>
<body>
	<h2 class="success">R Workspace Loaded</h2>
	<p>Objects from <code>${this.escapeHtml(fileName)}</code> have been loaded into your R session.</p>
	<p>You can close this tab.</p>
</body>
</html>`;
	}

	private getErrorHtml(fileName: string, error: unknown): string {
		return `<!DOCTYPE html>
<html>
<head>
	<style>
		body {
			font-family: var(--vscode-font-family);
			padding: 20px;
			color: var(--vscode-foreground);
		}
		.error { color: var(--vscode-testing-iconFailed); }
	</style>
</head>
<body>
	<h2 class="error">Error Loading R Workspace</h2>
	<p>Failed to load <code>${this.escapeHtml(fileName)}</code>.</p>
	<p>Error: ${this.escapeHtml(String(error))}</p>
</body>
</html>`;
	}

	private escapeHtml(text: string): string {
		return text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#039;');
	}
}

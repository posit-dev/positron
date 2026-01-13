/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';
import * as positron from 'positron';

/**
 * Custom editor provider for .RData/.rda files that loads the R workspace
 * instead of opening for text editing.
 */
export class RDataEditorProvider implements vscode.CustomReadonlyEditorProvider {

	public static readonly viewType = 'positron-r.rdataLoader';

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
		const fileName = path.basename(filePath);

		// Show loading message in webview
		webviewPanel.webview.html = this.getLoadingHtml(fileName);

		// Execute the load command
		try {
			const command = `load(${JSON.stringify(filePath)})`;
			await positron.runtime.executeCode('r', command, true);

			// Update webview to show success and close after a short delay
			webviewPanel.webview.html = this.getSuccessHtml(fileName);

			// Close the editor tab after a brief delay to show success
			setTimeout(() => {
				webviewPanel.dispose();
			}, 1500);
		} catch (error) {
			webviewPanel.webview.html = this.getErrorHtml(fileName, error);
		}
	}

	private getLoadingHtml(fileName: string): string {
		return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Loading R Workspace</title>
	<style>
		body {
			font-family: var(--vscode-font-family);
			padding: 20px;
			color: var(--vscode-foreground);
			background-color: var(--vscode-editor-background);
		}
		.container {
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			min-height: 200px;
		}
		.spinner {
			width: 32px;
			height: 32px;
			border: 3px solid var(--vscode-foreground);
			border-top-color: transparent;
			border-radius: 50%;
			animation: spin 1s linear infinite;
			margin-bottom: 16px;
		}
		@keyframes spin {
			to { transform: rotate(360deg); }
		}
		code {
			background-color: var(--vscode-textCodeBlock-background);
			padding: 2px 6px;
			border-radius: 3px;
		}
	</style>
</head>
<body>
	<div class="container">
		<div class="spinner"></div>
		<h2>Loading R Workspace</h2>
		<p>Loading objects from <code>${this.escapeHtml(fileName)}</code>...</p>
	</div>
</body>
</html>`;
	}

	private getSuccessHtml(fileName: string): string {
		return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>R Workspace Loaded</title>
	<style>
		body {
			font-family: var(--vscode-font-family);
			padding: 20px;
			color: var(--vscode-foreground);
			background-color: var(--vscode-editor-background);
		}
		.container {
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			min-height: 200px;
		}
		.success {
			color: var(--vscode-testing-iconPassed, #89d185);
		}
		.checkmark {
			font-size: 48px;
			margin-bottom: 16px;
		}
		code {
			background-color: var(--vscode-textCodeBlock-background);
			padding: 2px 6px;
			border-radius: 3px;
		}
	</style>
</head>
<body>
	<div class="container">
		<div class="checkmark success">✓</div>
		<h2 class="success">R Workspace Loaded</h2>
		<p>Objects from <code>${this.escapeHtml(fileName)}</code> have been loaded into your R session.</p>
	</div>
</body>
</html>`;
	}

	private getErrorHtml(fileName: string, error: unknown): string {
		return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Error Loading R Workspace</title>
	<style>
		body {
			font-family: var(--vscode-font-family);
			padding: 20px;
			color: var(--vscode-foreground);
			background-color: var(--vscode-editor-background);
		}
		.container {
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			min-height: 200px;
		}
		.error {
			color: var(--vscode-testing-iconFailed, #f14c4c);
		}
		.error-icon {
			font-size: 48px;
			margin-bottom: 16px;
		}
		code {
			background-color: var(--vscode-textCodeBlock-background);
			padding: 2px 6px;
			border-radius: 3px;
		}
		.error-message {
			margin-top: 16px;
			padding: 12px;
			background-color: var(--vscode-inputValidation-errorBackground);
			border: 1px solid var(--vscode-inputValidation-errorBorder);
			border-radius: 4px;
			max-width: 500px;
			word-break: break-word;
		}
	</style>
</head>
<body>
	<div class="container">
		<div class="error-icon error">!</div>
		<h2 class="error">Error Loading R Workspace</h2>
		<p>Failed to load <code>${this.escapeHtml(fileName)}</code>.</p>
		<div class="error-message">${this.escapeHtml(String(error))}</div>
	</div>
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

/**
 * Custom editor provider for .rds files that loads a single R object
 * into the R session with a generated variable name.
 */
export class RdsEditorProvider implements vscode.CustomReadonlyEditorProvider {

	public static readonly viewType = 'positron-r.rdsLoader';

	public static register(context: vscode.ExtensionContext): vscode.Disposable {
		const provider = new RdsEditorProvider(context);
		return vscode.window.registerCustomEditorProvider(
			RdsEditorProvider.viewType,
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
		const fileName = path.basename(filePath);

		// Generate a variable name from the filename (without extension)
		const varName = this.generateVariableName(filePath);

		// Show loading message in webview
		webviewPanel.webview.html = this.getLoadingHtml(fileName, varName);

		// Execute the readRDS command
		try {
			const command = `${varName} <- readRDS(${JSON.stringify(filePath)})`;
			await positron.runtime.executeCode('r', command, true);

			// Update webview to show success and close after a short delay
			webviewPanel.webview.html = this.getSuccessHtml(fileName, varName);

			// Close the editor tab after a brief delay to show success
			setTimeout(() => {
				webviewPanel.dispose();
			}, 1500);
		} catch (error) {
			webviewPanel.webview.html = this.getErrorHtml(fileName, varName, error);
		}
	}

	/**
	 * Generates a valid R variable name from a file path.
	 */
	private generateVariableName(filePath: string): string {
		// Get filename without extension
		const baseName = path.basename(filePath, path.extname(filePath));

		// Sanitize for R variable name:
		// - Replace non-alphanumeric characters (except . and _) with _
		// - Ensure it starts with a letter or dot followed by non-digit
		let varName = baseName.replace(/[^a-zA-Z0-9_.]/g, '_');

		// If it starts with a digit, prefix with underscore
		if (/^[0-9]/.test(varName)) {
			varName = '_' + varName;
		}

		// If empty after sanitization, use a default
		if (!varName || varName === '') {
			varName = 'rds_object';
		}

		return varName;
	}

	private getLoadingHtml(fileName: string, varName: string): string {
		return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Loading R Object</title>
	<style>
		body {
			font-family: var(--vscode-font-family);
			padding: 20px;
			color: var(--vscode-foreground);
			background-color: var(--vscode-editor-background);
		}
		.container {
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			min-height: 200px;
		}
		.spinner {
			width: 32px;
			height: 32px;
			border: 3px solid var(--vscode-foreground);
			border-top-color: transparent;
			border-radius: 50%;
			animation: spin 1s linear infinite;
			margin-bottom: 16px;
		}
		@keyframes spin {
			to { transform: rotate(360deg); }
		}
		code {
			background-color: var(--vscode-textCodeBlock-background);
			padding: 2px 6px;
			border-radius: 3px;
		}
	</style>
</head>
<body>
	<div class="container">
		<div class="spinner"></div>
		<h2>Loading R Object</h2>
		<p>Loading <code>${this.escapeHtml(fileName)}</code> as <code>${this.escapeHtml(varName)}</code>...</p>
	</div>
</body>
</html>`;
	}

	private getSuccessHtml(fileName: string, varName: string): string {
		return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>R Object Loaded</title>
	<style>
		body {
			font-family: var(--vscode-font-family);
			padding: 20px;
			color: var(--vscode-foreground);
			background-color: var(--vscode-editor-background);
		}
		.container {
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			min-height: 200px;
		}
		.success {
			color: var(--vscode-testing-iconPassed, #89d185);
		}
		.checkmark {
			font-size: 48px;
			margin-bottom: 16px;
		}
		code {
			background-color: var(--vscode-textCodeBlock-background);
			padding: 2px 6px;
			border-radius: 3px;
		}
	</style>
</head>
<body>
	<div class="container">
		<div class="checkmark success">✓</div>
		<h2 class="success">R Object Loaded</h2>
		<p>Object from <code>${this.escapeHtml(fileName)}</code> loaded as <code>${this.escapeHtml(varName)}</code>.</p>
	</div>
</body>
</html>`;
	}

	private getErrorHtml(fileName: string, varName: string, error: unknown): string {
		return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Error Loading R Object</title>
	<style>
		body {
			font-family: var(--vscode-font-family);
			padding: 20px;
			color: var(--vscode-foreground);
			background-color: var(--vscode-editor-background);
		}
		.container {
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			min-height: 200px;
		}
		.error {
			color: var(--vscode-testing-iconFailed, #f14c4c);
		}
		.error-icon {
			font-size: 48px;
			margin-bottom: 16px;
		}
		code {
			background-color: var(--vscode-textCodeBlock-background);
			padding: 2px 6px;
			border-radius: 3px;
		}
		.error-message {
			margin-top: 16px;
			padding: 12px;
			background-color: var(--vscode-inputValidation-errorBackground);
			border: 1px solid var(--vscode-inputValidation-errorBorder);
			border-radius: 4px;
			max-width: 500px;
			word-break: break-word;
		}
	</style>
</head>
<body>
	<div class="container">
		<div class="error-icon error">!</div>
		<h2 class="error">Error Loading R Object</h2>
		<p>Failed to load <code>${this.escapeHtml(fileName)}</code> as <code>${this.escapeHtml(varName)}</code>.</p>
		<div class="error-message">${this.escapeHtml(String(error))}</div>
	</div>
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

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';
import * as positron from 'positron';
import { runtimeManager } from './extension.js';
import { loadRDataFile, loadRdsFileWithVarName } from './commands.js';

/**
 * Result of checking R runtime availability.
 */
type RRuntimeStatus =
	| { status: 'ready' }
	| { status: 'waiting' }
	| { status: 'no-r-found' };

/**
 * Checks the current R runtime availability status.
 *
 * @returns The current status of R runtime availability
 */
async function checkRRuntimeStatus(): Promise<RRuntimeStatus> {
	// Check if there's an active R session
	const activeSessions = await positron.runtime.getActiveSessions();
	const hasActiveRSession = activeSessions.some(session =>
		session.runtimeMetadata.languageId === 'r'
	);

	if (hasActiveRSession) {
		return { status: 'ready' };
	}

	// Check if any R runtimes have been discovered
	const registeredRuntimes = await positron.runtime.getRegisteredRuntimes();
	const hasRegisteredR = registeredRuntimes.some(runtime =>
		runtime.languageId === 'r'
	);

	if (hasRegisteredR) {
		return { status: 'ready' };
	}

	// If discovery is complete and no R found, return no-r-found
	if (runtimeManager.isDiscoveryComplete) {
		return { status: 'no-r-found' };
	}

	// No R runtimes registered yet - still discovering
	return { status: 'waiting' };
}

/**
 * Waits for R runtime to become available. We do this to avoid trying to load
 * an RData or RDS file before R has been discovered, which would lead to
 * errors.
 *
 * This is primarily an issue when double-clicking an RData or RDS files from
 * the OS file explorer when no R sessions are active yet.
 *
 * @param webviewPanel The webview panel to update with status
 * @param fileName The name of the file being loaded
 * @param updateHtml Function to update the webview HTML
 * @param token Cancellation token
 * @returns Promise that resolves to true if R is available, false if no R was found
 */
async function waitForRRuntime(
	webviewPanel: vscode.WebviewPanel,
	fileName: string,
	updateHtml: (html: string) => void,
	token: vscode.CancellationToken
): Promise<boolean> {
	// First check current status
	const initialStatus = await checkRRuntimeStatus();
	if (initialStatus.status === 'ready') {
		return true;
	}
	if (initialStatus.status === 'no-r-found') {
		return false;
	}

	// Show waiting message
	updateHtml(getWaitingForRHtml(fileName));

	// Wait for discovery to complete or cancellation
	return new Promise<boolean>((resolve) => {
		const disposables: vscode.Disposable[] = [];
		let resolved = false;

		const cleanup = () => {
			if (!resolved) {
				resolved = true;
				disposables.forEach(d => d.dispose());
			}
		};
		// Listen for discovery completion
		disposables.push(
			runtimeManager.onDidCompleteDiscovery(() => {
				// Discovery completed - check if any R was found
				if (runtimeManager.discoveredRuntimeCount > 0) {
					cleanup();
					resolve(true);
				} else {
					cleanup();
					resolve(false);
				}
			})
		);

		// Handle cancellation
		disposables.push(
			token.onCancellationRequested(() => {
				cleanup();
				resolve(false);
			})
		);

		// Handle webview disposal
		disposables.push(
			webviewPanel.onDidDispose(() => {
				cleanup();
				resolve(false);
			})
		);
	});
}

/**
 * Generates HTML for the "waiting for R" state.
 */
function getWaitingForRHtml(fileName: string): string {
	return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Waiting for R</title>
	<style>${getBaseStyles()}${getSpinnerStyles()}</style>
</head>
<body>
	<div class="container">
		<div class="spinner"></div>
		<h2>Waiting for R...</h2>
		<p>Discovering R installations to load <code>${escapeHtml(fileName)}</code>...</p>
	</div>
</body>
</html>`;
}

/**
 * Returns CSS styles for the warning message box used in "no R found" state.
 */
function getWarningMessageStyles(): string {
	return `
		.message {
			margin-top: 16px;
			padding: 12px;
			background-color: var(--vscode-inputValidation-warningBackground);
			border: 1px solid var(--vscode-inputValidation-warningBorder);
			border-radius: 4px;
			max-width: 500px;
			text-align: center;
		}
		a {
			color: var(--vscode-textLink-foreground);
		}`;
}

/**
 * Generates HTML for the "no R found" error state.
 */
function getNoRFoundHtml(fileName: string): string {
	return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>R Required</title>
	<style>${getBaseStyles()}${getErrorStyles()}${getWarningMessageStyles()}</style>
</head>
<body>
	<div class="container">
		<div class="error-icon error">!</div>
		<h2 class="error">R Installation Required</h2>
		<p>Cannot load <code>${escapeHtml(fileName)}</code>.</p>
		<div class="message">
			An installation of R is required to load RData and RDS files.
			<br><br>
			<a href="https://positron.posit.co/r-installations">Learn more about R discovery</a>
		</div>
	</div>
</body>
</html>`;
}

/**
 * Escapes HTML special characters.
 */
function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

/**
 * Type of R file being loaded.
 */
type RFileType = 'workspace' | 'object';

/**
 * Returns the display label for a file type.
 */
function getTypeLabel(type: RFileType): string {
	return type === 'workspace' ? 'R Workspace' : 'R Object';
}

/**
 * Returns the base CSS styles shared by all loader HTML pages.
 */
function getBaseStyles(): string {
	return `
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
		code {
			background-color: var(--vscode-textCodeBlock-background);
			padding: 2px 6px;
			border-radius: 3px;
		}`;
}

/**
 * Returns CSS styles for the loading spinner.
 */
function getSpinnerStyles(): string {
	return `
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
		}`;
}

/**
 * Returns CSS styles for success state.
 */
function getSuccessStyles(): string {
	return `
		.success {
			color: var(--vscode-testing-iconPassed, #89d185);
		}
		.checkmark {
			font-size: 48px;
			margin-bottom: 16px;
		}`;
}

/**
 * Returns CSS styles for error state.
 */
function getErrorStyles(): string {
	return `
		.error {
			color: var(--vscode-testing-iconFailed, #f14c4c);
		}
		.error-icon {
			font-size: 48px;
			margin-bottom: 16px;
		}
		.error-message {
			margin-top: 16px;
			padding: 12px;
			background-color: var(--vscode-inputValidation-errorBackground);
			border: 1px solid var(--vscode-inputValidation-errorBorder);
			border-radius: 4px;
			max-width: 500px;
			word-break: break-word;
		}`;
}

/**
 * Generates HTML for the loading state.
 */
function getLoadingHtml(fileName: string, type: RFileType, varName?: string): string {
	const typeLabel = getTypeLabel(type);
	const message = type === 'workspace'
		? `Loading objects from <code>${escapeHtml(fileName)}</code>...`
		: `Loading <code>${escapeHtml(fileName)}</code> as <code>${escapeHtml(varName!)}</code>...`;

	return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Loading ${typeLabel}</title>
	<style>${getBaseStyles()}${getSpinnerStyles()}</style>
</head>
<body>
	<div class="container">
		<div class="spinner"></div>
		<h2>Loading ${typeLabel}</h2>
		<p>${message}</p>
	</div>
</body>
</html>`;
}

/**
 * Generates HTML for the success state.
 */
function getSuccessHtml(fileName: string, type: RFileType, varName?: string): string {
	const typeLabel = getTypeLabel(type);
	const message = type === 'workspace'
		? `Objects from <code>${escapeHtml(fileName)}</code> have been loaded into your R session.`
		: `Object from <code>${escapeHtml(fileName)}</code> loaded as <code>${escapeHtml(varName!)}</code>.`;

	return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${typeLabel} Loaded</title>
	<style>${getBaseStyles()}${getSuccessStyles()}</style>
</head>
<body>
	<div class="container">
		<div class="checkmark success">✓</div>
		<h2 class="success">${typeLabel} Loaded</h2>
		<p>${message}</p>
	</div>
</body>
</html>`;
}

/**
 * Generates HTML for the error state.
 */
function getErrorHtml(fileName: string, type: RFileType, error: unknown, varName?: string): string {
	const typeLabel = getTypeLabel(type);
	const message = type === 'workspace'
		? `Failed to load <code>${escapeHtml(fileName)}</code>.`
		: `Failed to load <code>${escapeHtml(fileName)}</code> as <code>${escapeHtml(varName!)}</code>.`;

	return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Error Loading ${typeLabel}</title>
	<style>${getBaseStyles()}${getErrorStyles()}</style>
</head>
<body>
	<div class="container">
		<div class="error-icon error">!</div>
		<h2 class="error">Error Loading ${typeLabel}</h2>
		<p>${message}</p>
		<div class="error-message">${escapeHtml(String(error))}</div>
	</div>
</body>
</html>`;
}

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

	constructor(private readonly _context: vscode.ExtensionContext) { }

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
		token: vscode.CancellationToken
	): Promise<void> {
		const filePath = document.uri.fsPath.replace(/\\/g, '/');
		const fileName = path.basename(filePath);

		// Wait for R runtime to be available
		const rAvailable = await waitForRRuntime(
			webviewPanel,
			fileName,
			(html) => { webviewPanel.webview.html = html; },
			token
		);

		if (!rAvailable) {
			// Either cancelled or no R found
			if (!token.isCancellationRequested) {
				webviewPanel.webview.html = getNoRFoundHtml(fileName);
			}
			return;
		}

		// Show loading message in webview
		webviewPanel.webview.html = getLoadingHtml(fileName, 'workspace');

		// Execute the load command
		try {
			await loadRDataFile(document.uri, false);

			// Update webview to show success and close after a short delay
			webviewPanel.webview.html = getSuccessHtml(fileName, 'workspace');

			// Close the editor tab after a brief delay to show success
			setTimeout(() => {
				webviewPanel.dispose();
			}, 1500);
		} catch (error) {
			webviewPanel.webview.html = getErrorHtml(fileName, 'workspace', error);
		}
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

	constructor(private readonly _context: vscode.ExtensionContext) { }

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
		token: vscode.CancellationToken
	): Promise<void> {
		const filePath = document.uri.fsPath.replace(/\\/g, '/');
		const fileName = path.basename(filePath);

		// Generate a variable name from the filename (without extension)
		const varName = this.generateVariableName(filePath);

		// Wait for R runtime to be available
		const rAvailable = await waitForRRuntime(
			webviewPanel,
			fileName,
			(html) => { webviewPanel.webview.html = html; },
			token
		);

		if (!rAvailable) {
			// Either cancelled or no R found
			if (!token.isCancellationRequested) {
				webviewPanel.webview.html = getNoRFoundHtml(fileName);
			}
			return;
		}

		// Show loading message in webview
		webviewPanel.webview.html = getLoadingHtml(fileName, 'object', varName);

		// Execute the readRDS command
		try {
			await loadRdsFileWithVarName(document.uri, varName);

			// Update webview to show success and close after a short delay
			webviewPanel.webview.html = getSuccessHtml(fileName, 'object', varName);

			// Close the editor tab after a brief delay to show success
			setTimeout(() => {
				webviewPanel.dispose();
			}, 1500);
		} catch (error) {
			webviewPanel.webview.html = getErrorHtml(fileName, 'object', error, varName);
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
}

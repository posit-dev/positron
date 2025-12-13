/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Runtime completion provider for Julia.
 *
 * NOTE: This provider is currently DISABLED because Silent execution mode doesn't
 * return results, and Transient mode pollutes the console. See TODO-LATER.md.
 *
 * When proper Jupyter complete_request support is added to positron-supervisor,
 * this code can be updated to use that API instead.
 */

import * as vscode from 'vscode';
import * as positron from 'positron';
import { LOGGER } from './extension';

/**
 * Provides runtime completions for Julia by querying the active Julia session.
 * This supplements the LSP completions with variables and functions defined in the current session.
 */
export class JuliaRuntimeCompletionProvider implements vscode.CompletionItemProvider, vscode.Disposable {

	private _pendingRequest: vscode.CancellationTokenSource | undefined;

	async provideCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken,
		_context: vscode.CompletionContext
	): Promise<vscode.CompletionItem[] | undefined> {

		// Only provide completions for Julia documents
		if (document.languageId !== 'julia') {
			return undefined;
		}

		// Check if there's an active Julia session
		const sessions = await positron.runtime.getActiveSessions();
		const juliaSession = sessions.find(s => s.runtimeMetadata.languageId === 'julia');
		if (!juliaSession) {
			return undefined;
		}

		// Get the text up to the cursor position
		const lineText = document.lineAt(position.line).text;
		const textBeforeCursor = lineText.substring(0, position.character);

		// Don't provide completions for empty input or just whitespace
		if (!textBeforeCursor.trim()) {
			return undefined;
		}

		// Cancel any pending request
		if (this._pendingRequest) {
			this._pendingRequest.cancel();
		}
		this._pendingRequest = new vscode.CancellationTokenSource();

		try {
			return await this.getJuliaCompletions(textBeforeCursor, position.character, token);
		} catch (error) {
			LOGGER.debug(`Runtime completion error: ${error}`);
			return undefined;
		}
	}

	private async getJuliaCompletions(
		code: string,
		cursorPos: number,
		token: vscode.CancellationToken
	): Promise<vscode.CompletionItem[]> {

		// Escape the code string for Julia
		const escapedCode = code
			.replace(/\\/g, '\\\\')
			.replace(/"/g, '\\"')
			.replace(/\n/g, '\\n');

		// Build Julia code to get completions using REPLCompletions
		const juliaCode = `let
	import REPL.REPLCompletions
	code = "${escapedCode}"
	completions, range, should_complete = REPLCompletions.completions(code, ${cursorPos})
	join([REPLCompletions.completion_text(c) for c in completions], "\\n")
end`;

		try {
			// NOTE: Using Transient mode because Silent doesn't return results.
			// This pollutes the console, which is why this provider is disabled.
			const result = await positron.runtime.executeCode(
				'julia',
				juliaCode,
				false,
				true,
				positron.RuntimeCodeExecutionMode.Transient,
				positron.RuntimeErrorBehavior.Continue,
				{ token }
			);

			const completionText = result['text/plain'] as string | undefined;
			if (!completionText) {
				return [];
			}

			// Parse the newline-separated completions (result is a quoted string)
			const cleanText = completionText.replace(/^"|"$/g, '');
			const completionStrings = cleanText.split('\\n').filter(s => s.length > 0);

			return completionStrings.map(text => {
				const item = new vscode.CompletionItem(text, vscode.CompletionItemKind.Variable);
				item.sortText = ` ${text}`; // Space prefix sorts before letters
				item.detail = '(runtime)';
				item.preselect = true;
				return item;
			});
		} catch (err) {
			LOGGER.debug(`executeCode failed: ${err}`);
			return [];
		}
	}

	dispose(): void {
		if (this._pendingRequest) {
			this._pendingRequest.cancel();
			this._pendingRequest = undefined;
		}
	}
}

/**
 * Registers the Julia runtime completion provider.
 */
export function registerCompletionProvider(context: vscode.ExtensionContext): vscode.Disposable {
	const provider = new JuliaRuntimeCompletionProvider();

	const disposable = vscode.languages.registerCompletionItemProvider(
		[
			{ language: 'julia', scheme: 'file' },
			{ language: 'julia', scheme: 'untitled' },
			{ language: 'julia', scheme: 'inmemory' },
		],
		provider
	);

	context.subscriptions.push(disposable);
	context.subscriptions.push(provider);

	LOGGER.info('Julia runtime completion provider registered');

	return disposable;
}

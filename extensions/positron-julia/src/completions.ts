/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

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

		LOGGER.info(`provideCompletionItems called for ${document.uri.scheme}:${document.languageId}`);

		// Only provide completions for Julia documents
		if (document.languageId !== 'julia') {
			LOGGER.debug('Not a Julia document, skipping');
			return undefined;
		}

		// Check if there's an active Julia session
		const sessions = await positron.runtime.getActiveSessions();
		const juliaSession = sessions.find(s => s.runtimeMetadata.languageId === 'julia');
		if (!juliaSession) {
			LOGGER.debug('No active Julia session, skipping runtime completions');
			return undefined;
		}

		// Get the text up to the cursor position
		const lineText = document.lineAt(position.line).text;
		const textBeforeCursor = lineText.substring(0, position.character);

		LOGGER.info(`Completion request for: "${textBeforeCursor}"`);

		// Don't provide completions for empty input or just whitespace
		if (!textBeforeCursor.trim()) {
			LOGGER.debug('Empty input, skipping');
			return undefined;
		}

		// Cancel any pending request
		if (this._pendingRequest) {
			this._pendingRequest.cancel();
		}
		this._pendingRequest = new vscode.CancellationTokenSource();

		try {
			// Get completions from the Julia runtime
			const completions = await this.getJuliaCompletions(
				textBeforeCursor,
				position.character,
				token
			);

			LOGGER.info(`Returning ${completions.length} completions`);
			return completions;
		} catch (error) {
			LOGGER.error(`Runtime completion error: ${error}`);
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

		// Build Julia code to get completions
		// We use REPLCompletions which is what IJulia uses internally
		const juliaCode = `let
	import REPL.REPLCompletions
	code = "${escapedCode}"
	completions, range, should_complete = REPLCompletions.completions(code, ${cursorPos})
	join([REPLCompletions.completion_text(c) for c in completions], "\\n")
end`;

		LOGGER.debug(`Getting runtime completions for: "${code}" at position ${cursorPos}`);

		try {
			// Execute with Transient mode to get result (Silent doesn't return values)
			// This will briefly show in console but is the only way to get results
			const result = await positron.runtime.executeCode(
				'julia',
				juliaCode,
				false, // don't focus
				true,  // allow incomplete
				positron.RuntimeCodeExecutionMode.Transient,
				positron.RuntimeErrorBehavior.Continue,
				{ token }
			);

			LOGGER.debug(`Completion result: ${JSON.stringify(result)}`);

			// The result contains the completion text as text/plain (quoted string)
			const completionText = result['text/plain'] as string | undefined;
			if (!completionText) {
				LOGGER.debug('No text/plain in result');
				return [];
			}

			// Parse the newline-separated completions
			// Result is like "\"print\\nprintln\\nprintstyled\""
			const cleanText = completionText.replace(/^"|"$/g, '');
			const completionStrings = cleanText.split('\\n').filter(s => s.length > 0);

			LOGGER.debug(`Parsed ${completionStrings.length} completions`);

			const items: vscode.CompletionItem[] = [];
			for (const text of completionStrings) {
				const item = new vscode.CompletionItem(
					text,
					vscode.CompletionItemKind.Variable
				);
				// Sort runtime completions first (space sorts before letters/numbers)
				item.sortText = ` ${text}`;
				item.detail = '(runtime)';
				// Boost priority so runtime variables appear at top
				item.preselect = true;
				items.push(item);
			}

			return items;
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

	LOGGER.info('Registering Julia runtime completion provider');

	// Register for Julia files and console (inmemory scheme)
	// No trigger characters - we want to be called for all completion requests
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

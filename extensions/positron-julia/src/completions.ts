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

		// Only provide completions for Julia documents
		if (document.languageId !== 'julia') {
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
			// Get completions from the Julia runtime
			const completions = await this.getJuliaCompletions(
				textBeforeCursor,
				position.character,
				token
			);

			return completions;
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

		// Build Julia code to get completions
		// We use REPLCompletions which is what IJulia uses internally
		// Return completions as a string that we can parse from the result
		const juliaCode = `let
	import REPL.REPLCompletions
	code = "${escapedCode}"
	completions, range, should_complete = REPLCompletions.completions(code, ${cursorPos})
	join([REPLCompletions.completion_text(c) for c in completions], "\\n")
end`;

		LOGGER.debug(`Getting runtime completions for: "${code}" at position ${cursorPos}`);

		try {
			// Execute the completion query silently and get the result
			const result = await positron.runtime.executeCode(
				'julia',
				juliaCode,
				false, // don't focus
				true,  // allow incomplete
				positron.RuntimeCodeExecutionMode.Silent,
				positron.RuntimeErrorBehavior.Continue,
				{ token }
			);

			LOGGER.debug(`Completion result: ${JSON.stringify(result)}`);

			// The result should contain the completion text as text/plain
			const completionText = result['text/plain'] as string | undefined;
			if (!completionText) {
				LOGGER.debug('No text/plain in result');
				return [];
			}

			// Parse the newline-separated completions (remove quotes if present)
			const cleanText = completionText.replace(/^"|"$/g, '');
			const completionStrings = cleanText.split('\\n').filter(s => s.length > 0);

			LOGGER.debug(`Parsed ${completionStrings.length} completions: ${completionStrings.join(', ')}`);

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

	// Register for Julia files and console (inmemory scheme)
	const disposable = vscode.languages.registerCompletionItemProvider(
		[
			{ language: 'julia', scheme: 'file' },
			{ language: 'julia', scheme: 'untitled' },
			{ language: 'julia', scheme: 'inmemory' },
		],
		provider,
		'.' // Trigger on dot for field/property access
	);

	context.subscriptions.push(disposable);
	context.subscriptions.push(provider);

	LOGGER.info('Julia runtime completion provider registered');

	return disposable;
}

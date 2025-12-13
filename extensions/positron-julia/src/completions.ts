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
		// Output format: one completion per line, prefixed with "COMPLETION:"
		const juliaCode = `
let
	import REPL.REPLCompletions
	code = "${escapedCode}"
	completions, range, should_complete = REPLCompletions.completions(code, ${cursorPos})
	for c in completions
		println("COMPLETION:", REPLCompletions.completion_text(c))
	end
end
`;

		LOGGER.debug(`Getting runtime completions for: "${code}" at position ${cursorPos}`);

		return new Promise<vscode.CompletionItem[]>((resolve) => {
			let output = '';
			const timeoutMs = 1000; // 1s timeout for completions

			// Create a timeout
			const timeout = setTimeout(() => {
				LOGGER.debug(`Runtime completion timed out. Output so far: "${output}"`);
				resolve([]);
			}, timeoutMs);

			// Execute the completion query silently
			LOGGER.debug(`Executing Julia completion code`);
			positron.runtime.executeCode(
				'julia',
				juliaCode,
				false, // don't focus
				true,  // allow incomplete
				positron.RuntimeCodeExecutionMode.Silent,
				positron.RuntimeErrorBehavior.Continue,
				{
					token,
					onStarted: () => {
						LOGGER.debug('Completion execution started');
					},
					onOutput: (message: string) => {
						LOGGER.debug(`Completion output: "${message}"`);
						output += message;
					},
					onError: (message: string) => {
						LOGGER.debug(`Completion error output: "${message}"`);
					},
					onCompleted: () => {
						clearTimeout(timeout);
						LOGGER.debug(`Completion finished. Full output: "${output}"`);
						// Parse the output - each line starting with "COMPLETION:" is a completion
						const lines = output.split('\n');
						const items: vscode.CompletionItem[] = [];
						for (const line of lines) {
							if (line.startsWith('COMPLETION:')) {
								const text = line.substring('COMPLETION:'.length);
								if (text) {
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
							}
						}
						LOGGER.debug(`Returning ${items.length} runtime completions`);
						resolve(items);
					},
					onFailed: (error: Error) => {
						clearTimeout(timeout);
						LOGGER.debug(`Completion execution failed: ${error.message}`);
						resolve([]);
					}
				}
			).catch((err: Error) => {
				clearTimeout(timeout);
				LOGGER.debug(`executeCode rejected: ${err.message}`);
				resolve([]);
			});
		});
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

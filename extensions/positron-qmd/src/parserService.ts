/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Disposable } from './util/disposable.js';
import { QmdParser } from './parser.js';
import { QmdDocument } from './qmdDocument.js';

/**
 * Service that manages the QMD parser and its associated commands.
 */
export class QmdParserService extends Disposable {
	private readonly _parser: QmdParser;

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly _log: vscode.LogOutputChannel,
	) {
		super();
		this._parser = new QmdParser(this._extensionUri);
		this._registerParseQmdDevCommand();
	}

	/**
	 * Parse QMD content.
	 */
	async parse(content: string): Promise<QmdDocument> {
		return this._parser.parse(content);
	}

	private _registerParseQmdDevCommand(): void {
		// Debug command to test WASM parser
		// Accepts optional string arg (for tests) or prompts for input (for manual testing)
		this._register(vscode.commands.registerCommand(
			'positron-qmd.parseQmd',
			async (content?: string) => {
				// Get content from: 1) argument, 2) prompt, 3) active editor
				let qmdContent = content;
				if (!qmdContent) {
					const input = await vscode.window.showInputBox({
						prompt: 'Enter QMD content (use \\n for newlines)',
						placeHolder: '---\\ntitle: Test\\n---\\n\\n# Hello',
					});
					if (input) {
						// Convert literal \n to actual newlines
						qmdContent = input.replace(/\\n/g, '\n');
					}
				}
				if (!qmdContent) {
					const editor = vscode.window.activeTextEditor;
					if (editor) {
						qmdContent = editor.document.getText();
					}
				}
				if (!qmdContent) {
					vscode.window.showWarningMessage('No content to parse');
					return;
				}

				try {
					// Parser handles lazy initialization automatically
					const result = await this._parser.parse(qmdContent);

					const outputChannel = vscode.window.createOutputChannel('QMD Parser Output');
					outputChannel.clear();
					outputChannel.appendLine('=== QMD Parse Result ===');
					outputChannel.appendLine(JSON.stringify(result, null, 2));
					outputChannel.show();

					this._log.debug('Parsed QMD content successfully');
					return result; // Return for programmatic use in tests
				} catch (error) {
					this._log.error(`Parse error: ${error}`);
					vscode.window.showErrorMessage(`Parse error: ${error}`);
				}
			}
		));
	}
}

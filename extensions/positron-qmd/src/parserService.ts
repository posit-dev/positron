/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Disposable } from './util/disposable.js';
import { QmdParser } from './parser.js';
import { QmdNotebookParser } from './notebookParser.js';

export class QmdParserService extends Disposable {
	readonly parser: QmdParser;
	readonly notebookParser: QmdNotebookParser;

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly _log: vscode.LogOutputChannel,
	) {
		super();
		this.parser = new QmdParser(this._extensionUri);
		this.notebookParser = new QmdNotebookParser(this._extensionUri);

		this._registerParseQmdDevCommand();
	}

	private _registerParseQmdDevCommand(): void {
		this._register(vscode.commands.registerCommand(
			'positron-qmd.parseQmd',
			async (content?: string) => {
				let qmdContent = content;
				if (!qmdContent) {
					const input = await vscode.window.showInputBox({
						prompt: 'Enter QMD content (use \\n for newlines)',
						placeHolder: '---\\ntitle: Test\\n---\\n\\n# Hello',
					});
					if (input) {
						qmdContent = input.replace(/\\n/g, '\n');
					}
				}
				if (!qmdContent) {
					vscode.window.showWarningMessage('No content to parse');
					return;
				}

				try {
					const result = await this.parser.parse(qmdContent);
					await vscode.env.clipboard.writeText(JSON.stringify(result, null, 2));
					this._log.debug('Parsed QMD content successfully');
					return result;
				} catch (error) {
					this._log.error(`Parse error: ${error}`);
					vscode.window.showErrorMessage(`Parse error: ${error}`);
				}
			}
		));
	}
}

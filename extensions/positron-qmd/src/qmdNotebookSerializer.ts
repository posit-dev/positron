/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { QmdParser } from './parser.js';
import { convertToNotebookData, convertFromNotebookData } from './converter.js';
import { TextDecoder, TextEncoder } from 'util';

/**
 * Notebook serializer for QMD files.
 * Converts QMD content to VS Code NotebookData for display in the notebook editor.
 */
export class QmdNotebookSerializer implements vscode.NotebookSerializer {
	constructor(
		private readonly _parser: QmdParser,
		private readonly _log: vscode.LogOutputChannel
	) { }

	async deserializeNotebook(
		content: Uint8Array,
		_token: vscode.CancellationToken
	): Promise<vscode.NotebookData> {
		const textContent = new TextDecoder().decode(content);

		// Return empty notebook for empty files
		if (!textContent.trim()) {
			return new vscode.NotebookData([]);
		}

		try {
			const qmdDoc = await this._parser.parse(textContent);
			// Pass source text to converter for source location extraction
			return convertToNotebookData(qmdDoc, textContent);
		} catch (error) {
			this._log.error(`Failed to parse QMD file: ${error}`);
			throw error;
		}
	}

	async serializeNotebook(
		data: vscode.NotebookData,
		_token: vscode.CancellationToken
	): Promise<Uint8Array> {
		const qmdText = convertFromNotebookData(data);
		return new TextEncoder().encode(qmdText);
	}
}

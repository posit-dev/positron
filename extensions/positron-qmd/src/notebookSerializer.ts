/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { QmdParser } from './parser.js';
import { deserialize } from './deserialize.js';
import { serialize } from './serialize.js';
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
		try {
			const doc = await this._parser.parse(new TextDecoder().decode(content));
			return deserialize(doc, content);
		} catch (error) {
			this._log.error(`Failed to parse QMD file: ${error}`);
			throw error;
		}
	}

	async serializeNotebook(
		data: vscode.NotebookData,
		_token: vscode.CancellationToken
	): Promise<Uint8Array> {
		try {
			const qmdText = serialize(data);
			return new TextEncoder().encode(qmdText);
		} catch (error) {
			this._log.error(`Failed to serialize QMD file: ${error}`);
			throw error;
		}
	}
}

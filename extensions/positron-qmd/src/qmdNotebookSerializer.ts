/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { QmdParser } from './parser.js';
import { deserialize } from './deserialize.js';
import { serialize } from './serialize.js';
import { TextDecoder, TextEncoder } from 'util';

function isEmpty(content: Uint8Array): boolean {
	for (let i = 0; i < content.length; i++) {
		const byte = content[i];
		if (byte !== 0x20 && byte !== 0x09 && byte !== 0x0A && byte !== 0x0D) {
			return false;
		}
	}
	return true;
}

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
		if (isEmpty(content)) {
			return new vscode.NotebookData([]);
		}

		try {
			const qmdDoc = await this._parser.parse(new TextDecoder().decode(content));
			return deserialize(qmdDoc, content);
		} catch (error) {
			this._log.error(`Failed to parse QMD file: ${error}`);
			throw error;
		}
	}

	async serializeNotebook(
		data: vscode.NotebookData,
		_token: vscode.CancellationToken
	): Promise<Uint8Array> {
		const qmdText = serialize(data);
		return new TextEncoder().encode(qmdText);
	}
}

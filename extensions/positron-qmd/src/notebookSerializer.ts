/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { QmdNotebookParser, NotebookCell } from './notebookParser.js';
import { TextDecoder, TextEncoder } from 'util';

export class QmdNotebookSerializer implements vscode.NotebookSerializer {
	constructor(
		private readonly _parser: QmdNotebookParser,
		private readonly _log: vscode.LogOutputChannel
	) { }

	async deserializeNotebook(
		content: Uint8Array,
		_token: vscode.CancellationToken
	): Promise<vscode.NotebookData> {
		try {
			const cells = await this._parser.parse(new TextDecoder().decode(content));
			return this._toNotebookData(cells);
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
			const cells = this._fromNotebookData(data);
			const qmdText = await this._parser.serialize(cells);
			return new TextEncoder().encode(qmdText);
		} catch (error) {
			this._log.error(`Failed to serialize QMD file: ${error}`);
			throw error;
		}
	}

	private _toNotebookData(cells: NotebookCell[]): vscode.NotebookData {
		const vscCells = cells.map(cell => {
			const kind = cell.kind === 'code'
				? vscode.NotebookCellKind.Code
				: vscode.NotebookCellKind.Markup;
			const cellData = new vscode.NotebookCellData(kind, cell.content, cell.languageId);
			if (cell.metadata) {
				cellData.metadata = cell.metadata;
			}
			return cellData;
		});
		return new vscode.NotebookData(vscCells);
	}

	private _fromNotebookData(data: vscode.NotebookData): NotebookCell[] {
		return data.cells.map((cell: vscode.NotebookCellData) => ({
			kind: cell.kind === vscode.NotebookCellKind.Code ? 'code' : 'markup',
			content: cell.value,
			languageId: cell.languageId,
			metadata: cell.metadata as NotebookCell['metadata'],
		}));
	}
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';


export interface ICellRange {
	range: vscode.Range;
	cell_type: string;
}


class CellMatcher {
	isCell(line: string): boolean {
		return line.startsWith('# %%');
	}

	getCellType(_line: string): string {
		return 'code';
	}
}


export function generateCellRangesFromDocument(document: vscode.TextDocument): ICellRange[] {
	// Implmentation of getCells here based on Don's Jupyter extension work
	const matcher = new CellMatcher();
	const cells: ICellRange[] = [];
	for (let index = 0; index < document.lineCount; index += 1) {
		const line = document.lineAt(index);
		if (matcher.isCell(line.text)) {
			if (cells.length > 0) {
				const previousCell = cells[cells.length - 1];
				previousCell.range = new vscode.Range(previousCell.range.start, document.lineAt(index - 1).range.end);
			}

			cells.push({
				range: line.range,
				cell_type: matcher.getCellType(line.text)
			});
		}
	}

	if (cells.length >= 1) {
		const line = document.lineAt(document.lineCount - 1);
		const previousCell = cells[cells.length - 1];
		previousCell.range = new vscode.Range(previousCell.range.start, line.range.end);
	}

	return cells;
}


export class CodeLensProvider implements vscode.CodeLensProvider {

	private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
	public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

	constructor() {
		// TODO: Not sure when we're supposed to fire onDidChangeCodeLenses
		vscode.workspace.onDidChangeConfiguration((_) => {
			this._onDidChangeCodeLenses.fire();
		});
	}

	public provideCodeLenses(document: vscode.TextDocument, _token: vscode.CancellationToken): vscode.CodeLens[] | Thenable<vscode.CodeLens[]> {
		const codeLenses: vscode.CodeLens[] = [];
		const cellRanges = generateCellRangesFromDocument(document);
		for (const cellRange of cellRanges) {
			codeLenses.push(new vscode.CodeLens(cellRange.range, { title: '$(run) Run cell', command: 'positron-editor-cells.runCell', arguments: [cellRange.range] }));
		}
		return codeLenses;
	}

	public resolveCodeLens(codeLens: vscode.CodeLens, _token: vscode.CancellationToken): vscode.CodeLens {
		// codeLens.command = {
		// 	title: '$(run) Codelens provided by sample extension',
		// 	tooltip: 'Tooltip provided by sample extension',
		// 	command: 'codelens-sample.codelensAction',
		// 	arguments: ['Argument 1', false]
		// };
		return codeLens;
	}
}

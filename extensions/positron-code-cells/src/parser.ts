/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';


export interface ICell {
	range: vscode.Range;
}


class CellMatcher {
	isCell(line: string): boolean {
		return line.startsWith('# %%');
	}
}


export function parseCells(document: vscode.TextDocument): ICell[] {
	// Implmentation of getCells here based on Don's Jupyter extension work
	const matcher = new CellMatcher();
	const cells: ICell[] = [];
	for (let index = 0; index < document.lineCount; index += 1) {
		const line = document.lineAt(index);
		if (matcher.isCell(line.text)) {
			if (cells.length > 0) {
				const previousCell = cells[cells.length - 1];
				previousCell.range = new vscode.Range(previousCell.range.start, document.lineAt(index - 1).range.end);
			}

			cells.push({
				range: line.range,
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

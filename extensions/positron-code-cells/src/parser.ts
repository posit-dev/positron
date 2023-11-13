/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export interface Cell {
	range: vscode.Range;
}

// TODO: This will need to be customizable per language
export function newCell(): string {
	return '\n# %%\n';
}

// TODO: This will need to be customizable per language
// TODO: Should (optionally) support cell types too e.g. `# %% [markdown|code]`
function isCell(line: string): boolean {
	return line === '# %%';
}

// This function was adapted from the vscode-jupyter extension.
export function parseCells(document: vscode.TextDocument): Cell[] {
	const cells: Cell[] = [];
	for (let index = 0; index < document.lineCount; index += 1) {
		const line = document.lineAt(index);
		if (isCell(line.text)) {
			if (cells.length > 0) {
				const previousCell = cells[cells.length - 1];
				previousCell.range = new vscode.Range(previousCell.range.start, document.lineAt(index - 1).range.end);
			}
			cells.push({ range: line.range });
		}
	}

	if (cells.length >= 1) {
		const line = document.lineAt(document.lineCount - 1);
		const previousCell = cells[cells.length - 1];
		previousCell.range = new vscode.Range(previousCell.range.start, line.range.end);
	}

	return cells;
}

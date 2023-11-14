/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export interface Cell {
	range: vscode.Range;
}

export interface CellParser {
	isCellStart(line: string): boolean;
	isCellEnd(line: string): boolean;
	newCell(): string;
}

// TODO: Expose an API to let extensions register parsers?
const pythonCellParser: CellParser = {
	isCellStart: (line) => line.startsWith('# %%'),
	isCellEnd: (_line) => false,
	newCell: () => '\n# %%\n',
};

const rCellParser: CellParser = {
	isCellStart: (line) => line.startsWith('#+'),
	isCellEnd: (line) => line.trim() === '',
	newCell: () => '\n#+\n',
};

const parsers: Map<string, CellParser> = new Map([
	['python', pythonCellParser],
	['r', rCellParser],
]);

export function getParser(languageId: string): CellParser | undefined {
	return parsers.get(languageId);
}

// This function was adapted from the vscode-jupyter extension.
export function parseCells(document: vscode.TextDocument): Cell[] {
	const parser = getParser(document.languageId);
	if (!parser) {
		return [];
	}

	const cells: Cell[] = [];
	let currentStart: vscode.Position | undefined;
	let currentEnd: vscode.Position | undefined;
	for (let index = 0; index < document.lineCount; index += 1) {
		const line = document.lineAt(index);

		if (parser.isCellStart(line.text)) {
			currentStart = line.range.start;
			currentEnd = undefined;
		}
		if (currentStart !== undefined) {
			if (parser.isCellEnd(line.text)) {
				currentEnd = document.lineAt(index - 1).range.end;
			} else if (index === document.lineCount - 1) {
				currentEnd = document.lineAt(index).range.end;
			}
		}

		if (currentStart && currentEnd) {
			cells.push({ range: new vscode.Range(currentStart, currentEnd) });
			currentStart = currentEnd = undefined;
		}
	}

	return cells;
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export interface Cell {
	range: vscode.Range;
	type: CellType;
}

export enum CellType {
	Code,
	Markdown,
}

export interface CellParser {
	isCellStart(line: string, additionalCellDelimiter: string): boolean;
	isCellEnd(line: string, additionalCellDelimiter: string): boolean;
	getCellType(line: string): CellType;
	getCellText(cell: Cell, document: vscode.TextDocument): string;
	newCell(): string;
}

function getCellText(cell: Cell, document: vscode.TextDocument): string {
	if (cell.range.start.line >= cell.range.end.line) {
		return '';
	}
	// Skip the cell marker line
	const range = new vscode.Range(
		cell.range.start.line + 1,
		cell.range.start.character,
		cell.range.end.line,
		cell.range.end.character
	);
	return document.getText(range);
}

const whitespaceRegExp = new RegExp(/^\s*$/);
const commentRegExp = new RegExp(/^# ?/);

// Get the text to be executed from a Jupyter markdown cell following the format
// described in https://jupytext.readthedocs.io/en/latest/formats-scripts.html.
function getJupyterMarkdownCellText(cell: Cell, document: vscode.TextDocument): string {
	let text = getCellText(cell, document);
	text = text.trim();
	// If all non-empty lines start with a comment, remove the comment characters
	const lines = text.split('\n');
	if (lines.every(line => whitespaceRegExp.test(line) || commentRegExp.test(line))) {
		text = lines.map(line => line.replace(commentRegExp, '')).join('\n');
	}
	// If the text is enclosed in """s, remove them
	if (text.startsWith(`"""`) && text.endsWith(`"""`) || text.startsWith(`'''`) && text.endsWith(`'''`)) {
		text = text.slice(3, -3).trim();
	}
	// Execute the resulting text with the %%markdown cell magic
	return `%%markdown\n${text}\n\n`;
}

// Spaces can not occur before #
const pythonIsCellStartRegExp = new RegExp(/^#\s*%%/);
const pythonMarkdownRegExp = new RegExp(/^#\s*%%[^[]*\[markdown\]/);
const rIsCellStartRegExp = new RegExp(/^#\s*(%%|\+)/);
const rIsSectionHeaderRegExp = new RegExp(/^#+.*[-=]{4,}\s*$/);

// Reading a configuration value is expensive: each call rebuilds and clones the
// consolidated configuration model in the extension host. Callers must read the
// delimiter once per parse and pass it down to the line predicates, never once
// per line of the document. See https://github.com/posit-dev/positron/issues/14990.
function getAdditionalCellDelimiter(): string {
	return vscode.workspace.getConfiguration('codeCells').get('additionalCellDelimiter', '# COMMAND ----------');
}

// TODO: Expose an API to let extensions register parsers
const pythonCellParser: CellParser = {
	isCellStart: (line, additionalCellDelimiter) => pythonIsCellStartRegExp.test(line) || line === additionalCellDelimiter,
	isCellEnd: () => false,
	getCellType: (line) => pythonMarkdownRegExp.test(line) ? CellType.Markdown : CellType.Code,
	getCellText: (cell, document) =>
		cell.type === CellType.Code
			? getCellText(cell, document)
			: getJupyterMarkdownCellText(cell, document),
	newCell: () => '\n# %%\n',
};

const rCellParser: CellParser = {
	isCellStart: (line, additionalCellDelimiter) => rIsCellStartRegExp.test(line) || line === additionalCellDelimiter,
	isCellEnd: (line, additionalCellDelimiter) => line !== additionalCellDelimiter && rIsSectionHeaderRegExp.test(line),
	getCellType: (_line) => CellType.Code,
	getCellText: getCellText,
	newCell: () => '\n# %%\n'
};

export const parsers: Map<string, CellParser> = new Map([
	['python', pythonCellParser],
	['r', rCellParser],
]);
export const supportedLanguageIds = Array.from(parsers.keys());

export function getParser(languageId: string): CellParser | undefined {
	return parsers.get(languageId);
}

// This function was adapted from the vscode-jupyter extension.
//
// The delimiter reader is injectable so that tests can count how often it is
// called; production callers use the default.
export function parseCells(
	document: vscode.TextDocument,
	readAdditionalCellDelimiter: () => string = getAdditionalCellDelimiter,
): Cell[] {
	const parser = getParser(document.languageId);
	if (!parser) {
		return [];
	}

	// Read once for the whole document, before the loop over its lines.
	const additionalCellDelimiter = readAdditionalCellDelimiter();

	const cells: Cell[] = [];
	let currentStart: vscode.Position | undefined;
	let currentType: CellType | undefined;
	let currentEnd: vscode.Position | undefined;
	for (let index = 0; index < document.lineCount; index += 1) {
		const line = document.lineAt(index);

		if (parser.isCellStart(line.text, additionalCellDelimiter)) {
			// The current cell had no explicit end, close and push it now
			if (currentStart !== undefined && currentType !== undefined && currentEnd === undefined) {
				currentEnd = document.lineAt(index - 1).range.end;
				cells.push({ range: new vscode.Range(currentStart, currentEnd), type: currentType });
			}

			// Start a new cell
			currentStart = line.range.start;
			currentType = parser.getCellType(line.text);
			currentEnd = undefined;
		}

		if (currentStart !== undefined) {
			if (parser.isCellEnd(line.text, additionalCellDelimiter)) {
				// The current cell has an explicit end
				currentEnd = document.lineAt(index - 1).range.end;
			} else if (index === document.lineCount - 1) {
				// This is the last line of the document, end the current cell
				currentEnd = document.lineAt(index).range.end;
			}
		}

		if (currentStart !== undefined && currentType !== undefined && currentEnd !== undefined) {
			cells.push({ range: new vscode.Range(currentStart, currentEnd), type: currentType });
			currentStart = currentType = currentEnd = undefined;
		}
	}

	return cells;
}

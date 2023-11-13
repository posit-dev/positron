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


export function generateCellRangesFromDocument(document: vscode.TextDocument): ICell[] {
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

function runCellCodeLens(range: vscode.Range, line: number): vscode.CodeLens {
	return new vscode.CodeLens(range, {
		title: '$(run) Run Cell',
		command: 'positron.runCurrentCell',
		arguments: [line],
	});
}


function runAboveCodeLens(range: vscode.Range, line: number): vscode.CodeLens {
	return new vscode.CodeLens(range, {
		title: '$(run-above) Run Above',
		command: 'positron.runCellsAbove',
		arguments: [line],
	});
}

function runNextCodeLens(range: vscode.Range, line: number): vscode.CodeLens {
	return new vscode.CodeLens(
		range,
		{
			title: '$(run-next) Run Next',
			command: 'positron.runNextCell',
			arguments: [line],
		});
}

export function registerCodeLensProvider(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider('*', {
			provideCodeLenses: (document, _token) => {
				if (['vscode-notebook-cell', 'vscode-interactive-input'].includes(document.uri.scheme)) {
					return [];
				}

				const codeLenses: vscode.CodeLens[] = [];
				const cells = generateCellRangesFromDocument(document);
				for (let i = 0; i < cells.length; i += 1) {
					const cell = cells[i];
					const range = cell.range;
					const line = range.start.line;
					codeLenses.push(runCellCodeLens(range, line));
					if (i > 0) {
						codeLenses.push(runAboveCodeLens(range, line));
					}
					if (i < cells.length - 1) {
						codeLenses.push(runNextCodeLens(range, line));
					}
				}

				// TODO: Should this live elsewhere?
				if (cells.length) {
					vscode.commands.executeCommand(
						'setContext',
						'positron.hasCodeCells',
						true,
					);
				}

				return codeLenses;
			}
		}));
}

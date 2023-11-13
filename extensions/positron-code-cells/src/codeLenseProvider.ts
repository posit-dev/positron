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


class CodeLensProvider implements vscode.CodeLensProvider {

	private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
	public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

	constructor() {
		// TODO: Not sure when we're supposed to fire onDidChangeCodeLenses
		vscode.workspace.onDidChangeConfiguration((_) => {
			this._onDidChangeCodeLenses.fire();
		});
	}

	public provideCodeLenses(document: vscode.TextDocument, _token: vscode.CancellationToken): vscode.CodeLens[] | Thenable<vscode.CodeLens[]> {
		if (['vscode-notebook-cell', 'vscode-interactive-input'].includes(document.uri.scheme)) {
			return [];
		}

		const codeLenses: vscode.CodeLens[] = [];
		const cells = generateCellRangesFromDocument(document);
		for (let i = 0; i < cells.length; i += 1) {
			const cell = cells[i];
			codeLenses.push(
				new vscode.CodeLens(
					cell.range,
					{
						title: '$(run) Run Cell',
						command: 'positron.runCurrentCell',
						arguments: [cell.range.start.line]
					}));
			if (i > 0) {
				codeLenses.push(
					new vscode.CodeLens(
						cell.range,
						{
							title: 'Run Above',
							command: 'positron.runCellsAbove',
							arguments: [cell.range.start.line]
						}));
			}
			if (i < cells.length - 1) {
				codeLenses.push(
					new vscode.CodeLens(
						cell.range,
						{
							title: 'Run Next Cell',
							command: 'positron.runNextCell',
							arguments: [cell.range.start.line]
						}));
			}
		}

		if (cells.length) {
			vscode.commands.executeCommand(
				'setContext',
				'positron.hasCodeCells',
				true,
			);
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

export function registerCodeLensProvider(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider('*', new CodeLensProvider())
	);
}

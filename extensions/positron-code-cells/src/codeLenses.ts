/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { parseCells } from './parser';
import { IGNORED_SCHEMES } from './extension';

function runCellCodeLens(range: vscode.Range, line: number): vscode.CodeLens {
	return new vscode.CodeLens(range, {
		title: vscode.l10n.t('$(run) Run Cell'),
		command: 'positron.runCurrentCell',
		arguments: [line],
	});
}

function runAboveCodeLens(range: vscode.Range, line: number): vscode.CodeLens {
	return new vscode.CodeLens(range, {
		title: vscode.l10n.t('Run Above'),
		command: 'positron.runCellsAbove',
		arguments: [line],
	});
}

function runNextCodeLens(range: vscode.Range, line: number): vscode.CodeLens {
	return new vscode.CodeLens(range, {
		title: vscode.l10n.t('Run Next'),
		command: 'positron.runNextCell',
		arguments: [line],
	});
}

export function registerCodeLensProvider(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider('*', {
			provideCodeLenses: (document, _token) => {
				if (IGNORED_SCHEMES.includes(document.uri.scheme)) {
					return [];
				}

				const codeLenses: vscode.CodeLens[] = [];
				const cells = parseCells(document);
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

				return codeLenses;
			}
		}));
}

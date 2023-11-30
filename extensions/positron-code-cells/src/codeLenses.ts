/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { parseCells } from './parser';
import { IGNORED_SCHEMES } from './extension';

export function runCellCodeLens(range: vscode.Range): vscode.CodeLens {
	return new vscode.CodeLens(range, {
		title: vscode.l10n.t('$(run) Run Cell'),
		command: 'positron.runCurrentCell',
		arguments: [range.start.line],
	});
}

export function runAboveCodeLens(range: vscode.Range): vscode.CodeLens {
	return new vscode.CodeLens(range, {
		title: vscode.l10n.t('Run Above'),
		command: 'positron.runCellsAbove',
		arguments: [range.start.line],
	});
}

export function runNextCodeLens(range: vscode.Range): vscode.CodeLens {
	return new vscode.CodeLens(range, {
		title: vscode.l10n.t('Run Next'),
		command: 'positron.runNextCell',
		arguments: [range.start.line],
	});
}

export class CellCodeLensProvider implements vscode.CodeLensProvider {
	provideCodeLenses(document: vscode.TextDocument): vscode.ProviderResult<vscode.CodeLens[]> {
		if (IGNORED_SCHEMES.includes(document.uri.scheme)) {
			return [];
		}

		const codeLenses: vscode.CodeLens[] = [];
		const cells = parseCells(document);
		for (let i = 0; i < cells.length; i += 1) {
			const cell = cells[i];
			const range = cell.range;
			codeLenses.push(runCellCodeLens(range));
			if (i > 0) {
				codeLenses.push(runAboveCodeLens(range));
			}
			if (i < cells.length - 1) {
				codeLenses.push(runNextCodeLens(range));
			}
		}

		return codeLenses;
	}
}

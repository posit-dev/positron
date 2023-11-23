/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { parseCells } from './parser';

export class CellFoldingRangeProvider implements vscode.FoldingRangeProvider {
	provideFoldingRanges(document: vscode.TextDocument): vscode.ProviderResult<vscode.FoldingRange[]> {
		return parseCells(document).map((cell) =>
			new vscode.FoldingRange(cell.range.start.line, cell.range.end.line)
		);
	}
}

export function registerFoldingRangeProvider(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.languages.registerFoldingRangeProvider('*', new CellFoldingRangeProvider()),
	);
}

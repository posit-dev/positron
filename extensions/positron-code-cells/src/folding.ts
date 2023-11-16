/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { parseCells } from './parser';

export function registerFoldingRangeProvider(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.languages.registerFoldingRangeProvider('*', {
			provideFoldingRanges: (document) =>
				parseCells(document).map((cell) =>
					new vscode.FoldingRange(cell.range.start.line, cell.range.end.line)
				)
		}),
	);
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { initializeLogging } from './logging';
import { CellCodeLensProvider } from './codeLenses';
import { registerCommands } from './commands';
import { activateDecorations } from './decorations';
import { CellFoldingRangeProvider } from './folding';
import { activateContextKeys } from './context';

export const IGNORED_SCHEMES = ['vscode-notebook-cell', 'vscode-interactive-input'];

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	initializeLogging();

	registerCommands(context.subscriptions);

	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider('*', new CellCodeLensProvider()),

		vscode.languages.registerFoldingRangeProvider('*', new CellFoldingRangeProvider()),
	);

	activateDecorations(context.subscriptions);

	activateContextKeys(context.subscriptions);
}

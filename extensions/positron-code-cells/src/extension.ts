/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { initializeLogging } from './logging';
import { registerCodeLensProvider } from './codeLenseProvider';
import { registerCommands } from './commands';
import { registerDecorations } from './decorations';
import { registerFoldingRangeProvider } from './folding';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	initializeLogging();

	registerCodeLensProvider(context);

	registerCommands(context);

	registerDecorations(context);

	registerFoldingRangeProvider(context);

	// Set the default value of the hasCodeCells context variable upon onDidChangeActiveTextEditor
	vscode.window.onDidChangeActiveTextEditor(() => {
		// TODO: Do we need to actually check if it has cells?
		vscode.commands.executeCommand(
			'setContext',
			'positron.hasCodeCells',
			false,
		);
	}, null, context.subscriptions);
}

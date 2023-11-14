/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { initializeLogging } from './logging';
import { registerCodeLensProvider } from './codeLenses';
import { registerCommands } from './commands';
import { registerDecorations } from './decorations';
import { registerFoldingRangeProvider } from './folding';
import { registerContextKeys } from './context';

export const IGNORED_SCHEMES = ['vscode-notebook-cell', 'vscode-interactive-input'];

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	initializeLogging();

	registerCodeLensProvider(context);

	registerCommands(context);

	registerDecorations(context);

	registerFoldingRangeProvider(context);

	registerContextKeys(context);
}

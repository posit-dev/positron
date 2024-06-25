/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { initializeLogging } from './logging';
import { CellCodeLensProvider } from './codeLenses';
import { registerCommands } from './commands';
import { activateDecorations } from './decorations';
import { activateContextKeys } from './context';

export const IGNORED_SCHEMES = ['vscode-notebook-cell', 'vscode-interactive-input'];

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	initializeLogging();

	registerCommands(context.subscriptions);

	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider('*', new CellCodeLensProvider()),

		// Temporarily disabled because registering this provider causes it to
		// become the *only* folding range provider for R and Python files,
		// suppressing the built-in folding range provider.
		//
		// We can re-enable this when the R and Python language packs supply
		// their own folding range providers.
		//
		// https://github.com/posit-dev/positron/issues/1908

		// vscode.languages.registerFoldingRangeProvider('*', new CellFoldingRangeProvider()),
	);

	activateDecorations(context.subscriptions);

	activateContextKeys(context.subscriptions);
}

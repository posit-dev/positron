/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { initializeLogging } from './logging';
import { CellCodeLensProvider } from './codeLenses';
import { activateDecorations } from './decorations';
import { activateContextKeys } from './context';
import { activateDocumentManagers } from './documentManager';
import { registerCommands } from './commands';

export const IGNORED_SCHEMES = ['vscode-notebook-cell', 'vscode-interactive-input'];

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	initializeLogging();

	// Setup document parsing and cache
	activateDocumentManagers(context.subscriptions);

	// Commands for running cells and jumping around cells
	registerCommands(context.subscriptions);

	context.subscriptions.push(
		// Adds 'Run Cell' | 'Run Above' | 'Run Below' code lens for cells
		vscode.languages.registerCodeLensProvider('*', new CellCodeLensProvider()),

		// Listen for configuration changes and prompt to restart
		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('codeCells.additionalCellDelimiter')) {
				void vscode.window.showInformationMessage(
					vscode.l10n.t('Code cell delimiter configuration changed. Please restart Positron for changes to take effect.'),
					vscode.l10n.t('Reload Window')
				).then(selection => {
					if (selection === vscode.l10n.t('Reload Window')) {
						void vscode.commands.executeCommand('workbench.action.reloadWindow');
					}
				});
			}
		}),

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

	// Adds background for currently active code cell
	activateDecorations(context.subscriptions);

	// Adds `positron.hasCodeCells` to when clause for keybindings
	activateContextKeys(context.subscriptions);
}

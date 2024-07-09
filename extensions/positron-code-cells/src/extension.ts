/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { initializeLogging } from './logging';
import { CellCodeLensProvider } from './codeLenses';
import { activateDecorations } from './decorations';
import { activateContextKeys } from './context';
import { canHaveCells, destroyDocumentManager, getOrCreateDocumentManager } from './documentManager';
import { registerCommands } from './commands';

export const IGNORED_SCHEMES = ['vscode-notebook-cell', 'vscode-interactive-input', 'inmemory'];

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	initializeLogging();

	// When starting extension, fill documentManagers
	const activeEditors = vscode.window.visibleTextEditors;
	activeEditors.forEach((editor) => {
		if (canHaveCells(editor.document)) {
			const docManager = getOrCreateDocumentManager(editor.document);
			docManager.parseCells();
		}
	});
	vscode.workspace.onDidCloseTextDocument(document => {
		destroyDocumentManager(document);
	});
	vscode.workspace.onDidOpenTextDocument(document => {
		if (canHaveCells(document)) {
			const docManager = getOrCreateDocumentManager(document);
			docManager.parseCells();
		}
	});
	vscode.workspace.onDidChangeTextDocument(event => {
		// Trigger a decorations update when the active editor's content changes.
		if (!canHaveCells(event.document)) {
			// Used to have `|| !event.document.isDirty` to prevent parsing cells twice, but two tests failed for reasons I do not understand.
			// Early return if document has not changed or language does not have a parser
			return;
		}
		const docManager = getOrCreateDocumentManager(event.document);
		docManager.parseCells();
	});


	registerCommands(context.subscriptions);

	context.subscriptions.push(
		// Adds 'Run Cell' | 'Run Above' | 'Run Below' code lens for cells
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

	// Adds background for currently active code cell
	activateDecorations(context.subscriptions);

	// Adds `positron.hasCodeCells` to when clause for keybindings
	activateContextKeys(context.subscriptions);
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';
import { log } from './extension.js';
import { DisposableStore } from './util.js';
import { Command } from './constants.js';
import { NotebookDebugAdapterFactory } from './notebookDebugAdapterFactory.js';

export function activateNotebookDebugging(): vscode.Disposable {
	const disposables = new DisposableStore();

	const adapterFactory = disposables.add(new NotebookDebugAdapterFactory());
	disposables.add(vscode.debug.registerDebugAdapterDescriptorFactory('notebook', adapterFactory));

	disposables.add(vscode.commands.registerCommand(Command.DebugCell, debugCell));

	return disposables;
}

/**
 * Debug a notebook cell.
 *
 * @param cell The notebook cell to debug. If undefined, the active cell will be used.
 */
async function debugCell(cell: vscode.NotebookCell | undefined): Promise<void> {
	// This command can be called from:
	// 1. A cell's execute menu (`cell` is defined).
	// 2. The command palette (`cell` is undefined).

	// If no cell is provided, use the selected cell.
	if (!cell) {
		cell = getActiveNotebookCell();

		// If no cell is selected, log a warning and return.
		if (!cell) {
			// TODO: Should we show a notification instead?
			log.warn(`${Command.DebugCell} command called without a cell.`);
			return;
		}
	}

	// Start a debug session for the cell.
	// This will, in turn, create a debug adapter for the notebook using the factory defined above.
	await vscode.debug.startDebugging(undefined, {
		type: 'notebook',
		name: path.basename(cell.notebook.uri.fsPath),
		request: 'attach',
		// TODO: Get from config.
		justMyCode: true,
		__notebookUri: cell.notebook.uri.toString(),
		__cellUri: cell.document.uri.toString(),
	});
}

/** Get the active notebook cell, if one exists. */
function getActiveNotebookCell(): vscode.NotebookCell | undefined {
	const editor = vscode.window.activeNotebookEditor;
	if (editor) {
		const range = editor.selections[0];
		if (range) {
			return editor.notebook.cellAt(range.start);
		}
	}
	return undefined;
}

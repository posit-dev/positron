/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { log } from './extension.js';
import { Disposable, isUriEqual } from './util.js';
import { NotebookDebugAdapterFactory } from './notebookDebugAdapterFactory.js';

const DebugCellCommand = 'notebook.debugCell';

/**
 * Service to manage debugging notebooks.
 */
export class NotebookDebugService extends Disposable {
	constructor() {
		super();

		// Register the debug adapter factory for notebooks.
		const adapterFactory = this._register(new NotebookDebugAdapterFactory());
		this._register(vscode.debug.registerDebugAdapterDescriptorFactory('notebook', adapterFactory));

		// Register the command to debug a notebook cell.
		this._register(vscode.commands.registerCommand(DebugCellCommand, debugCell));
	}
}

const PositronNotebookEditorInputId = 'workbench.input.positronNotebook';

interface PositronNotebookCell extends vscode.NotebookCell {
	// Add any additional properties or methods specific to Positron notebook cells here.
	editorInputId: typeof PositronNotebookEditorInputId;
}

function isPositronNotebookCell(cell: vscode.NotebookCell): cell is PositronNotebookCell {
	const obj = cell as PositronNotebookCell;
	return obj.editorInputId === PositronNotebookEditorInputId;
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

		// It shouldn't be possible to call this command without a cell, log just in case.
		if (!cell) {
			log.error(`${DebugCellCommand} command called without a cell.`);
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
		__isPositron: isPositronNotebookCell(cell),
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

/** Get the language runtime session for a notebook. */
export async function getNotebookSession(notebookUri: vscode.Uri): Promise<positron.LanguageRuntimeSession | undefined> {
	const runtimeSessions = await positron.runtime.getActiveSessions();
	const runtimeSession = runtimeSessions.find(
		(session) => session.metadata.notebookUri && isUriEqual(session.metadata.notebookUri, notebookUri)
	);
	return runtimeSession;
}

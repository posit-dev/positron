/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { canHaveCells, getOrCreateDocumentManager } from './documentManager';

export interface SetDecorations {
	(
		editor: vscode.TextEditor,
		decorationType: vscode.TextEditorDecorationType,
		ranges: vscode.Range[]
	): void;
}

function defaultSetDecorations(
	editor: vscode.TextEditor,
	decorationType: vscode.TextEditorDecorationType,
	ranges: vscode.Range[]
): void {
	editor.setDecorations(decorationType, ranges);
}

export const cellDecorationType = vscode.window.createTextEditorDecorationType({
	light: { backgroundColor: '#E1E1E166' },
	dark: { backgroundColor: '#40404066' },
	isWholeLine: true,
});

export function activateDecorations(
	disposables: vscode.Disposable[],
	setDecorations: SetDecorations = defaultSetDecorations,
): void {
	let timeout: NodeJS.Timeout | undefined = undefined;
	let activeEditor = vscode.window.activeTextEditor;

	// Update the active editor's cell decorations.
	function updateDecorations() {
		if (!activeEditor || !canHaveCells(activeEditor.document)) {
			return;
		}

		const docManager = getOrCreateDocumentManager(activeEditor.document);
		const cells = docManager.getCells();

		// Get the relevant decoration ranges.
		const activeCellRanges: vscode.Range[] = [];
		const allCellRanges: vscode.Range[] = [];
		for (const cell of cells) {
			allCellRanges.push(cell.range);
			if (cell.range.contains(activeEditor.selection.active)) {
				activeCellRanges.push(cell.range);
			}
		}

		// Set decorations depending on the language configuration.
		setDecorations(activeEditor, cellDecorationType, activeCellRanges);
	}

	// Trigger an update of the active editor's cell decorations, with optional throttling.
	function triggerUpdateDecorations(throttle = false) {
		if (timeout) {
			clearTimeout(timeout);
			timeout = undefined;
		}
		if (throttle) {
			timeout = setTimeout(updateDecorations, 250);
		} else {
			updateDecorations();
		}
	}

	// Trigger a decorations update for the current active editor.
	if (activeEditor) {
		triggerUpdateDecorations();
	}

	disposables.push(
		vscode.window.onDidChangeActiveTextEditor(editor => {
			// Update the active editor.
			activeEditor = editor;
			// Trigger a decorations update when the active editor changes.
			if (editor) {
				triggerUpdateDecorations();
			}
		}),

		vscode.workspace.onDidChangeTextDocument(event => {
			// Trigger a decorations update when the active editor's content changes.
			if (activeEditor && event.document === activeEditor.document) {
				triggerUpdateDecorations(true);
			}
		}),

		vscode.window.onDidChangeTextEditorSelection(event => {
			// Trigger a decorations update when the active editor's selection changes.
			if (activeEditor && event.textEditor === activeEditor) {
				triggerUpdateDecorations();
			}
		}),
	);
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getOrCreateDocumentManager } from './documentManager';

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

// Create decoration types for focused cell borders
export const focusedCellTopDecorationType = vscode.window.createTextEditorDecorationType({
	borderColor: new vscode.ThemeColor('interactive.activeCodeBorder'),
	borderWidth: '2px 0px 0px 0px',
	borderStyle: 'solid',
	isWholeLine: true,
});

export const focusedCellBottomDecorationType = vscode.window.createTextEditorDecorationType({
	borderColor: new vscode.ThemeColor('interactive.activeCodeBorder'),
	borderWidth: '0px 0px 1px 0px',
	borderStyle: 'solid',
	isWholeLine: true,
});

// Create decoration types for unfocused cell borders
export const unfocusedCellTopDecorationType = vscode.window.createTextEditorDecorationType({
	borderColor: new vscode.ThemeColor('interactive.inactiveCodeBorder'),
	borderWidth: '2px 0px 0px 0px',
	borderStyle: 'solid',
	isWholeLine: true,
});

export const unfocusedCellBottomDecorationType = vscode.window.createTextEditorDecorationType({
	borderColor: new vscode.ThemeColor('interactive.inactiveCodeBorder'),
	borderWidth: '0px 0px 1px 0px',
	borderStyle: 'solid',
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
		const docManager = activeEditor && getOrCreateDocumentManager(activeEditor.document);
		if (!activeEditor || !docManager) {
			return;
		}

		// Get the relevant decoration ranges.
		const cells = docManager.getCells();
		const focusedCellTopRanges: vscode.Range[] = [];
		const focusedCellBottomRanges: vscode.Range[] = [];
		const unfocusedCellTopRanges: vscode.Range[] = [];
		const unfocusedCellBottomRanges: vscode.Range[] = [];

		// Get the currently selected position
		const selectionPosition = activeEditor.selection.active;

		for (const cell of cells) {
			// Determine if the cell is focused (contains the current selection)
			const isFocused = cell.range.contains(selectionPosition);

			// Create ranges for the top and bottom lines of the cell
			const topLineRange = new vscode.Range(
				cell.range.start.line,
				0,
				cell.range.start.line,
				0
			);

			const bottomLineRange = new vscode.Range(
				cell.range.end.line,
				0,
				cell.range.end.line,
				0
			);

			// Add to the appropriate collection based on focus state
			if (isFocused) {
				focusedCellTopRanges.push(topLineRange);
				focusedCellBottomRanges.push(bottomLineRange);
			} else {
				unfocusedCellTopRanges.push(topLineRange);
				unfocusedCellBottomRanges.push(bottomLineRange);
			}
		}

		// Set decorations for focused and unfocused cells
		setDecorations(activeEditor, focusedCellTopDecorationType, focusedCellTopRanges);
		setDecorations(activeEditor, focusedCellBottomDecorationType, focusedCellBottomRanges);
		setDecorations(activeEditor, unfocusedCellTopDecorationType, unfocusedCellTopRanges);
		setDecorations(activeEditor, unfocusedCellBottomDecorationType, unfocusedCellBottomRanges);
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
		// Trigger a decorations update when the active editor changes.
		vscode.window.onDidChangeActiveTextEditor(editor => {
			activeEditor = editor;
			if (editor) {
				triggerUpdateDecorations();
			}
		}),

		// Trigger a decorations update when the active editor's content changes.
		vscode.workspace.onDidChangeTextDocument(event => {
			if (activeEditor && event.document === activeEditor.document) {
				triggerUpdateDecorations(true);
			}
		}),

		// Trigger a decorations update when the active editor's selection changes.
		vscode.window.onDidChangeTextEditorSelection(event => {
			if (activeEditor && event.textEditor === activeEditor) {
				triggerUpdateDecorations();
			}
		}),
	);
}

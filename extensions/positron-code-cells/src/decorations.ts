/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IGNORED_SCHEMES } from './extension';
import { CellDecorationSetting, getParser, parseCells } from './parser';

export function activateDecorations(context: vscode.ExtensionContext): void {
	let timeout: NodeJS.Timer | undefined = undefined;
	let activeEditor = vscode.window.activeTextEditor;

	const cellDecorationType = vscode.window.createTextEditorDecorationType({
		light: { backgroundColor: '#E1E1E166' },
		dark: { backgroundColor: '#40404066' },
		isWholeLine: true,
	});

	// Update the active editor's cell decorations.
	function updateDecorations() {
		if (!activeEditor || IGNORED_SCHEMES.includes(activeEditor.document.uri.scheme)) {
			return;
		}
		const parser = getParser(activeEditor.document.languageId);
		if (!parser) {
			return;
		}

		// Get the relevant decoration ranges.
		const activeCellRanges: vscode.Range[] = [];
		const allCellRanges: vscode.Range[] = [];
		for (const cell of parseCells(activeEditor.document)) {
			allCellRanges.push(cell.range);
			if (cell.range.contains(activeEditor.selection.active)) {
				activeCellRanges.push(cell.range);
			}
		}

		// Set decorations depending on the language configuration.
		switch (parser.cellDecorationSetting()) {
			case CellDecorationSetting.Current:
				activeEditor.setDecorations(cellDecorationType, activeCellRanges);
				break;
			case CellDecorationSetting.All:
				activeEditor.setDecorations(cellDecorationType, allCellRanges);
				break;
		}
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

	context.subscriptions.push(
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

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IGNORED_SCHEMES } from './extension';
import { getParser, parseCells } from './parser';

export function registerDecorations(context: vscode.ExtensionContext): void {
	let timeout: NodeJS.Timer | undefined = undefined;
	let activeEditor = vscode.window.activeTextEditor;

	const cellDecorationType = vscode.window.createTextEditorDecorationType({
		light: { backgroundColor: '#E1E1E166' },
		dark: { backgroundColor: '#40404066' },
		isWholeLine: true,
	});

	function updateDecorations() {
		if (!activeEditor || IGNORED_SCHEMES.includes(activeEditor.document.uri.scheme)) {
			return;
		}
		const parser = getParser(activeEditor.document.languageId);

		const activeCellRanges: vscode.Range[] = [];
		const allCellRanges: vscode.Range[] = [];
		for (const cell of parseCells(activeEditor.document)) {
			allCellRanges.push(cell.range);
			if (cell.range.contains(activeEditor.selection.active)) {
				activeCellRanges.push(cell.range);
			}
		}

		if (parser) {
			switch (parser.cellDecoration()) {
				case 'current':
					activeEditor.setDecorations(cellDecorationType, activeCellRanges);
					break;
				case 'all':
					activeEditor.setDecorations(cellDecorationType, allCellRanges);
					break;
			}
		}
	}

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

	if (activeEditor) {
		triggerUpdateDecorations();
	}

	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(editor => {
			activeEditor = editor;
			if (editor) {
				triggerUpdateDecorations();
			}
		}),

		vscode.workspace.onDidChangeTextDocument(event => {
			if (activeEditor && event.document === activeEditor.document) {
				triggerUpdateDecorations(true);
			}
		}),

		vscode.window.onDidChangeTextEditorSelection(event => {
			if (activeEditor && event.textEditor === activeEditor) {
				triggerUpdateDecorations();
			}
		}),
	);
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { CellManager } from './cellManager';
import { IGNORED_SCHEMES } from './extension';

export function registerDecorations(context: vscode.ExtensionContext): void {
	let timeout: NodeJS.Timer | undefined = undefined;
	let activeEditor = vscode.window.activeTextEditor;

	const activeCellDecorationType = vscode.window.createTextEditorDecorationType({
		light: {
			backgroundColor: '#E1E1E166'
		},
		dark: {
			backgroundColor: '#40404066'
		},
		isWholeLine: true,
	});

	function updateDecorations() {
		if (!activeEditor || IGNORED_SCHEMES.includes(activeEditor.document.uri.scheme)) {
			return;
		}
		const activeCell = new CellManager(activeEditor).getCurrentCell(activeEditor.selection.active.line);
		if (activeCell) {
			activeEditor.setDecorations(activeCellDecorationType, [activeCell.range]);
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

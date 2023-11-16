/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getParser, parseCells } from './parser';

function setSupportsCodeCellsContext(editor: vscode.TextEditor | undefined): void {
	vscode.commands.executeCommand(
		'setContext',
		'positron.supportsCodeCells',
		editor && getParser(editor.document.languageId),
	);
}

function setHasCodeCellsContext(document: vscode.TextDocument | undefined): void {
	vscode.commands.executeCommand(
		'setContext',
		'positron.hasCodeCells',
		document && parseCells(document).length > 0,
	);
}

export function activateContextKeys(context: vscode.ExtensionContext): void {
	let activeEditor = vscode.window.activeTextEditor;

	if (activeEditor) {
		setSupportsCodeCellsContext(activeEditor);
		setHasCodeCellsContext(activeEditor.document);
	}

	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor((editor) => {
			// Update the active editor.
			activeEditor = editor;

			// Set the context keys.
			setSupportsCodeCellsContext(editor);
			setHasCodeCellsContext(editor?.document);
		}),

		vscode.workspace.onDidChangeTextDocument((event) => {
			// Set the hasCodeCells context key when the active editor's document changes.
			if (activeEditor && event.document === activeEditor.document) {
				setHasCodeCellsContext(event.document);
			}
		})
	);
}

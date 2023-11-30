/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getParser, parseCells } from './parser';

export enum ContextKey {
	SupportsCodeCells = 'positron.supportsCodeCells',
	HasCodeCells = 'positron.hasCodeCells',
}

export const contexts: Map<ContextKey, boolean | undefined> = new Map([
	[ContextKey.SupportsCodeCells, false],
	[ContextKey.HasCodeCells, false],
]);

function setSupportsCodeCellsContext(editor: vscode.TextEditor | undefined): void {
	const value = editor && getParser(editor.document.languageId) !== undefined;
	contexts.set(ContextKey.SupportsCodeCells, value);
	vscode.commands.executeCommand(
		'setContext',
		ContextKey.SupportsCodeCells,
		value,
	);
}

function setHasCodeCellsContext(document: vscode.TextDocument | undefined): void {
	const value = document && parseCells(document).length > 0;
	contexts.set(ContextKey.HasCodeCells, value);
	vscode.commands.executeCommand(
		'setContext',
		'positron.hasCodeCells',
		value,
	);
}

export function activateContextKeys(disposables: vscode.Disposable[]): void {
	let activeEditor = vscode.window.activeTextEditor;

	if (activeEditor) {
		setSupportsCodeCellsContext(activeEditor);
		setHasCodeCellsContext(activeEditor.document);
	}

	disposables.push(
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

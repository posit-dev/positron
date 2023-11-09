/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { initializeLogging } from './logging';
import { CodeLensProvider, generateCellRangesFromDocument } from './codeLenseProvider';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	initializeLogging();

	const codelensProvider = new CodeLensProvider();

	vscode.languages.registerCodeLensProvider('*', codelensProvider);

	context.subscriptions.push(
		vscode.commands.registerCommand('positron-editor-cells.runCurrentCell', () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor || !editor.selection) {
				return;
			}

			const cellRanges = generateCellRangesFromDocument(editor.document);
			const currentSelection = editor.selection;
			const i = cellRanges.findIndex(cellRange => cellRange.range.contains(currentSelection.start));
			const cellRange = cellRanges[i];

			const text = editor.document.getText(cellRange.range);
			positron.runtime.executeCode(editor.document.languageId, text, true);
		}),

		vscode.commands.registerCommand('positron-editor-cells.goToPreviousCell', () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor || !editor.selection) {
				return;
			}

			const cellRanges = generateCellRangesFromDocument(editor.document);
			const currentSelection = editor.selection;
			const i = cellRanges.findIndex(cellRange => cellRange.range.contains(currentSelection.start));
			if (i > 0) {
				const previousCellRange = cellRanges[i - 1];
				editor.selection = new vscode.Selection(previousCellRange.range.start, previousCellRange.range.start);
				editor.revealRange(previousCellRange.range);
			}
		}),

		vscode.commands.registerCommand('positron-editor-cells.goToNextCell', () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor || !editor.selection) {
				return;
			}

			const cellRanges = generateCellRangesFromDocument(editor.document);
			const currentSelection = editor.selection;
			const i = cellRanges.findIndex(cellRange => cellRange.range.contains(currentSelection.start));
			if (i < cellRanges.length - 1) {
				const nextCellRange = cellRanges[i + 1];
				editor.selection = new vscode.Selection(nextCellRange.range.start, nextCellRange.range.start);
				editor.revealRange(nextCellRange.range);
			}
		}),
	);

	let timeout: NodeJS.Timer | undefined = undefined;

	const activeCellDecorationType = vscode.window.createTextEditorDecorationType({
		light: {
			backgroundColor: '#E1E1E166'
		},
		dark: {
			backgroundColor: '#40404066'
		},
		isWholeLine: true,
	});

	let activeEditor = vscode.window.activeTextEditor;

	function updateDecorations() {
		if (!activeEditor) {
			return;
		}
		const cellRanges = generateCellRangesFromDocument(activeEditor.document);
		const activeCellRanges: vscode.Range[] = [];
		for (const cellRange of cellRanges) {
			// If the cursor is in the cellRange, then highlight it
			if (activeEditor.selection.active.line >= cellRange.range.start.line &&
				activeEditor.selection.active.line <= cellRange.range.end.line) {
				activeCellRanges.push(cellRange.range);
				break;
			}
		}
		activeEditor.setDecorations(activeCellDecorationType, activeCellRanges);
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

	vscode.window.onDidChangeActiveTextEditor(editor => {
		activeEditor = editor;
		if (editor) {
			triggerUpdateDecorations();
		}
	}, null, context.subscriptions);

	vscode.workspace.onDidChangeTextDocument(event => {
		if (activeEditor && event.document === activeEditor.document) {
			triggerUpdateDecorations(true);
		}
	}, null, context.subscriptions);

	vscode.window.onDidChangeTextEditorSelection(event => {
		if (activeEditor && event.textEditor === activeEditor) {
			triggerUpdateDecorations();
		}
	}, null, context.subscriptions);

	vscode.languages.registerFoldingRangeProvider('*', {
		provideFoldingRanges: (document) =>
			generateCellRangesFromDocument(document).map((cellRange) =>
				new vscode.FoldingRange(cellRange.range.start.line, cellRange.range.end.line)
			)
	});
}

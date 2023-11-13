/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { initializeLogging } from './logging';
import { CodeLensProvider, ICellRange, generateCellRangesFromDocument } from './codeLenseProvider';


function runCellRange(cellRange: ICellRange): void {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		return;
	}
	// Skip the cell marker
	// TODO: Should we use the same regex matcher?
	// TODO: Not sure why end needs a +1 too?
	const range = new vscode.Range(cellRange.range.start.line + 1, 0, cellRange.range.end.line + 1, 0);
	const text = editor.document.getText(range);
	positron.runtime.executeCode(editor.document.languageId, text, true);
}

function runCurrentCell(line?: number): void {
	const editor = vscode.window.activeTextEditor;
	if (!editor || !(line || editor.selection)) {
		return;
	}

	const cellRanges = generateCellRangesFromDocument(editor.document);
	const position = line === undefined ? editor.selection.start : new vscode.Position(line, 0);
	const i = cellRanges.findIndex(cellRange => cellRange.range.contains(position));
	const cellRange = cellRanges[i];
	runCellRange(cellRange);
}

function goToNextCell(line?: number): boolean {
	const editor = vscode.window.activeTextEditor;
	if (!editor || !(line || editor.selection)) {
		return false;
	}

	const cellRanges = generateCellRangesFromDocument(editor.document);
	const position = line === undefined ? editor.selection.start : new vscode.Position(line, 0);
	const i = cellRanges.findIndex(cellRange => cellRange.range.contains(position));
	if (i < cellRanges.length - 1) {
		const nextCellRange = cellRanges[i + 1];
		// Skip the cell marker
		const position = new vscode.Position(nextCellRange.range.start.line + 1, 0);
		editor.selection = new vscode.Selection(position, position);
		editor.revealRange(nextCellRange.range);
		return true;
	}

	return false;
}

function goToPreviousCell(line?: number): boolean {
	const editor = vscode.window.activeTextEditor;
	if (!editor || !(line || editor.selection)) {
		return false;
	}

	const cellRanges = generateCellRangesFromDocument(editor.document);
	const position = line === undefined ? editor.selection.start : new vscode.Position(line, 0);
	const i = cellRanges.findIndex(cellRange => cellRange.range.contains(position));
	if (i > 0) {
		const previousCellRange = cellRanges[i - 1];
		// Skip the cell marker
		const position = new vscode.Position(previousCellRange.range.start.line + 1, 0);
		editor.selection = new vscode.Selection(position, position);
		editor.revealRange(previousCellRange.range);
		return true;
	}

	return false;
}

async function insertCodeCell(): Promise<void> {
	const editor = vscode.window.activeTextEditor;
	if (!editor || !editor.selection) {
		return;
	}

	const cellRanges = generateCellRangesFromDocument(editor.document);
	const position = editor.selection.active;
	const i = cellRanges.findIndex(cellRange => cellRange.range.contains(position));
	const cellRange = cellRanges[i];

	// TODO: Allow customizing/extending cell markers
	const cellMarker = '# %%';
	// Add the cell marker and navigate to the end of the new cell
	await editor.edit(editBuilder => {
		const cellText = `\n${cellMarker}\n`;
		editBuilder.insert(cellRange.range.end, cellText);
	});

	goToNextCell();
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	initializeLogging();

	const codelensProvider = new CodeLensProvider();

	vscode.languages.registerCodeLensProvider('*', codelensProvider);

	context.subscriptions.push(
		vscode.commands.registerCommand('positron-editor-cells.runCurrentCell', runCurrentCell),

		vscode.commands.registerCommand('positron-editor-cells.runCurrentAdvance', async () => {
			runCurrentCell();
			if (!goToNextCell()) {
				// TODO: Only create the new cell if the current one is empty?
				await insertCodeCell();
			}
		}),

		vscode.commands.registerCommand('positron-editor-cells.runNextCell', (line?: number) => {
			if (goToNextCell(line)) {
				runCurrentCell();
			}
		}),

		vscode.commands.registerCommand('positron-editor-cells.runPreviousCell', (line?: number) => {
			if (goToPreviousCell(line)) {
				runCurrentCell();
			}
		}),

		vscode.commands.registerCommand('positron-editor-cells.runAllCells', () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				return;
			}

			const cellRanges = generateCellRangesFromDocument(editor.document);
			for (const cellRange of cellRanges) {
				runCellRange(cellRange);
			}
		}),

		vscode.commands.registerCommand('positron-editor-cells.runCellsAbove', (line?: number) => {
			const editor = vscode.window.activeTextEditor;
			if (!editor || !(line || editor.selection)) {
				return;
			}

			const position = line === undefined ? editor.selection.start : new vscode.Position(line, 0);
			const cellRanges = generateCellRangesFromDocument(editor.document);
			const i = cellRanges.findIndex(cellRange => cellRange.range.contains(position));
			for (const cellRange of cellRanges.slice(0, i)) {
				runCellRange(cellRange);
			}
		}),

		vscode.commands.registerCommand('positron-editor-cells.runCellsBelow', (line?: number) => {
			const editor = vscode.window.activeTextEditor;
			if (!editor || !(line || editor.selection)) {
				return;
			}

			const position = line === undefined ? editor.selection.start : new vscode.Position(line, 0);
			const cellRanges = generateCellRangesFromDocument(editor.document);
			const i = cellRanges.findIndex(cellRange => cellRange.range.contains(position));
			for (const cellRange of cellRanges.slice(i + 1)) {
				runCellRange(cellRange);
			}
		}),

		vscode.commands.registerCommand('positron-editor-cells.goToPreviousCell', goToPreviousCell),

		vscode.commands.registerCommand('positron-editor-cells.goToNextCell', goToNextCell),

		vscode.commands.registerCommand('positron-editor-cells.insertCodeCell', insertCodeCell),
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

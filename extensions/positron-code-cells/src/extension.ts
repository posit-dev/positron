/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { initializeLogging } from './logging';
import { CodeLensProvider, ICell, generateCellRangesFromDocument } from './codeLenseProvider';


function runCell(cell: ICell): void {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		return;
	}
	// Skip the cell marker
	// TODO: Should we use the same regex matcher?
	const range = new vscode.Range(cell.range.start.line + 1, 0, cell.range.end.line, cell.range.end.character);
	const text = editor.document.getText(range);
	positron.runtime.executeCode(editor.document.languageId, text, true);
}

function runCurrentCell(line?: number): void {
	const editor = vscode.window.activeTextEditor;
	if (!editor || !(line || editor.selection)) {
		return;
	}

	const cells = generateCellRangesFromDocument(editor.document);
	const position = line === undefined ? editor.selection.start : new vscode.Position(line, 0);
	const i = cells.findIndex(cell => cell.range.contains(position));
	const cell = cells[i];
	runCell(cell);
}

function goToNextCell(line?: number): boolean {
	const editor = vscode.window.activeTextEditor;
	if (!editor || !(line || editor.selection)) {
		return false;
	}

	const cells = generateCellRangesFromDocument(editor.document);
	const position = line === undefined ? editor.selection.start : new vscode.Position(line, 0);
	const i = cells.findIndex(cell => cell.range.contains(position));
	if (i < cells.length - 1) {
		const nextCellRange = cells[i + 1];
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

	const cells = generateCellRangesFromDocument(editor.document);
	const position = line === undefined ? editor.selection.start : new vscode.Position(line, 0);
	const i = cells.findIndex(cell => cell.range.contains(position));
	if (i > 0) {
		const previousCellRange = cells[i - 1];
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

	const cells = generateCellRangesFromDocument(editor.document);
	const position = editor.selection.active;
	const i = cells.findIndex(cell => cell.range.contains(position));
	const cell = cells[i];

	// TODO: Allow customizing/extending cell markers
	const cellMarker = '# %%';
	// Add the cell marker and navigate to the end of the new cell
	await editor.edit(editBuilder => {
		const cellText = `\n${cellMarker}\n`;
		editBuilder.insert(cell.range.end, cellText);
	});

	goToNextCell();
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	initializeLogging();

	const codelensProvider = new CodeLensProvider();

	vscode.languages.registerCodeLensProvider('*', codelensProvider);

	context.subscriptions.push(
		vscode.commands.registerCommand('positron.runCurrentCell', runCurrentCell),

		vscode.commands.registerCommand('positron.runCurrentAdvance', async () => {
			runCurrentCell();
			goToNextCell();
		}),

		vscode.commands.registerCommand('positron.runNextCell', (line?: number) => {
			if (goToNextCell(line)) {
				runCurrentCell();
			}
		}),

		vscode.commands.registerCommand('positron.runPreviousCell', (line?: number) => {
			if (goToPreviousCell(line)) {
				runCurrentCell();
			}
		}),

		vscode.commands.registerCommand('positron.runAllCells', () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				return;
			}

			const cells = generateCellRangesFromDocument(editor.document);
			for (const cell of cells) {
				runCell(cell);
			}
		}),

		vscode.commands.registerCommand('positron.runCellsAbove', (line?: number) => {
			const editor = vscode.window.activeTextEditor;
			if (!editor || !(line || editor.selection)) {
				return;
			}

			const position = line === undefined ? editor.selection.start : new vscode.Position(line, 0);
			const cells = generateCellRangesFromDocument(editor.document);
			const i = cells.findIndex(cell => cell.range.contains(position));
			for (const cell of cells.slice(0, i)) {
				runCell(cell);
			}
		}),

		vscode.commands.registerCommand('positron.runCellsBelow', (line?: number) => {
			const editor = vscode.window.activeTextEditor;
			if (!editor || !(line || editor.selection)) {
				return;
			}

			const position = line === undefined ? editor.selection.start : new vscode.Position(line, 0);
			const cells = generateCellRangesFromDocument(editor.document);
			const i = cells.findIndex(cell => cell.range.contains(position));
			for (const cell of cells.slice(i + 1)) {
				runCell(cell);
			}
		}),

		vscode.commands.registerCommand('positron.goToPreviousCell', goToPreviousCell),

		vscode.commands.registerCommand('positron.goToNextCell', goToNextCell),

		vscode.commands.registerCommand('positron.insertCodeCell', insertCodeCell),
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
		if (!activeEditor || ['vscode-notebook-cell', 'vscode-interactive-input'].includes(activeEditor.document.uri.scheme)) {
			return;
		}
		const cells = generateCellRangesFromDocument(activeEditor.document);
		const activeCellRanges: vscode.Range[] = [];
		for (const cell of cells) {
			// If the cursor is in the cell, then highlight it
			if (activeEditor.selection.active.line >= cell.range.start.line &&
				activeEditor.selection.active.line <= cell.range.end.line) {
				activeCellRanges.push(cell.range);
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
			generateCellRangesFromDocument(document).map((cell) =>
				new vscode.FoldingRange(cell.range.start.line, cell.range.end.line)
			)
	});

	// Set the default value of the hasCodeCells context variable upon onDidChangeActiveTextEditor
	vscode.window.onDidChangeActiveTextEditor(() => {
		// TODO: Do we need to actually check if it has cells?
		vscode.commands.executeCommand(
			'setContext',
			'positron.hasCodeCells',
			false,
		);
	}, null, context.subscriptions);
}

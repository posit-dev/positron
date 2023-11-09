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
		vscode.commands.registerCommand('positron-editor-cells.runCell', (range: vscode.Range) => {
			const document = vscode.window.activeTextEditor?.document!;

			// Skip the cell marker
			// TODO: Should we do this? Should this happen in the code lens provider?
			const newRange = new vscode.Range(range.start.line + 1, 0, range.end.line, range.end.character);
			// TODO: Should we trim?
			const text = document.getText(newRange).trim();

			positron.runtime.executeCode(document.languageId, text, true);
		})
	);

	let timeout: NodeJS.Timer | undefined = undefined;

	// // TODO: Move imports to top
	// const fs = require('fs');
	// const path = require('path');

	// // TODO: IDK if we can reliably get the comment color...
	// const themePath = path.join(vscode.extensions.getExtension('vscode.theme-defaults')!.extensionPath, 'themes', 'light_vs.json');
	// const themeContent = JSON.parse(fs.readFileSync(themePath, 'utf8'));
	// // TODO: Propertly type this
	// const commentColor = themeContent.tokenColors.filter((tokenColor: any) => tokenColor.scope === 'comment').map((tokenColor: any) => tokenColor.settings.foreground);
	// const commentColor = '#008000';

	const cellTopDecorationType = vscode.window.createTextEditorDecorationType({
		borderWidth: '1px 0px 0px 0px',
		borderStyle: 'solid',
		isWholeLine: true,
		light: {
			borderColor: '#E1E1E1'
		},
		dark: {
			borderColor: '#404040'
		},
	});
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
		// Loop through cellRange indices
		for (const cellRange of cellRanges) {
			// If the cursor is in the cellRange, then highlight it
			if (activeEditor.selection.active.line >= cellRange.range.start.line &&
				activeEditor.selection.active.line <= cellRange.range.end.line) {
				activeCellRanges.push(cellRange.range);
				break;
			}
		}
		activeEditor.setDecorations(activeCellDecorationType, activeCellRanges);

		// Loop through all except first cellRanges
		const cellTopRanges: vscode.Range[] = [];
		for (let i = 1; i < cellRanges.length; i += 1) {
			const cellRange = cellRanges[i];
			const cellTopRange = new vscode.Range(cellRange.range.start, cellRange.range.start);
			cellTopRanges.push(cellTopRange);
		}
		activeEditor.setDecorations(cellTopDecorationType, cellTopRanges);
	}

	function triggerUpdateDecorations(throttle = false) {
		if (timeout) {
			clearTimeout(timeout);
			timeout = undefined;
		}
		if (throttle) {
			timeout = setTimeout(updateDecorations, 500);
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

	// When the cursor position changes, trigger update decorations
	vscode.window.onDidChangeTextEditorSelection(event => {
		if (activeEditor && event.textEditor === activeEditor) {
			// TODO: Don't redo _all_ decorations, only active cell?
			triggerUpdateDecorations();
		}
	}, null, context.subscriptions);
}

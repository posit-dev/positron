/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { initializeLogging } from './logging';
import { CodeLensProvider } from './codeLenseProvider';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	initializeLogging();

	// const document = vscode.window.activeTextEditor?.document!;
	// const cellRanges = generateCellRangesFromDocument(document);

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

	// let timeout: NodeJS.Timer | undefined = undefined;

	// // create a decorator type that we use to decorate small numbers
	// const smallNumberDecorationType = vscode.window.createTextEditorDecorationType({
	// 	borderWidth: '1px',
	// 	borderStyle: 'solid',
	// 	overviewRulerColor: 'blue',
	// 	overviewRulerLane: vscode.OverviewRulerLane.Right,
	// 	light: {
	// 		// this color will be used in light color themes
	// 		borderColor: 'darkblue'
	// 	},
	// 	dark: {
	// 		// this color will be used in dark color themes
	// 		borderColor: 'lightblue'
	// 	}
	// });

	// // create a decorator type that we use to decorate large numbers
	// const largeNumberDecorationType = vscode.window.createTextEditorDecorationType({
	// 	cursor: 'crosshair',
	// 	// use a themable color. See package.json for the declaration and default values.
	// 	backgroundColor: { id: 'myextension.largeNumberBackground' }
	// });

	// let activeEditor = vscode.window.activeTextEditor;

	// function updateDecorations() {
	// 	if (!activeEditor) {
	// 		return;
	// 	}
	// 	const regEx = /\d+/g;
	// 	const text = activeEditor.document.getText();
	// 	const smallNumbers: vscode.DecorationOptions[] = [];
	// 	const largeNumbers: vscode.DecorationOptions[] = [];
	// 	let match;
	// 	while ((match = regEx.exec(text))) {
	// 		const startPos = activeEditor.document.positionAt(match.index);
	// 		const endPos = activeEditor.document.positionAt(match.index + match[0].length);
	// 		const decoration = { range: new vscode.Range(startPos, endPos), hoverMessage: 'Number **' + match[0] + '**' };
	// 		if (match[0].length < 3) {
	// 			smallNumbers.push(decoration);
	// 		} else {
	// 			largeNumbers.push(decoration);
	// 		}
	// 	}
	// 	activeEditor.setDecorations(smallNumberDecorationType, smallNumbers);
	// 	activeEditor.setDecorations(largeNumberDecorationType, largeNumbers);
	// }

	// function triggerUpdateDecorations(throttle = false) {
	// 	if (timeout) {
	// 		clearTimeout(timeout);
	// 		timeout = undefined;
	// 	}
	// 	if (throttle) {
	// 		timeout = setTimeout(updateDecorations, 500);
	// 	} else {
	// 		updateDecorations();
	// 	}
	// }

	// if (activeEditor) {
	// 	triggerUpdateDecorations();
	// }

	// vscode.window.onDidChangeActiveTextEditor(editor => {
	// 	activeEditor = editor;
	// 	if (editor) {
	// 		triggerUpdateDecorations();
	// 	}
	// }, null, context.subscriptions);

	// vscode.workspace.onDidChangeTextDocument(event => {
	// 	if (activeEditor && event.document === activeEditor.document) {
	// 		triggerUpdateDecorations(true);
	// 	}
	// }, null, context.subscriptions);


}

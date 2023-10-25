/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { lastRuntimePath } from './runtime';

export async function registerFormatter(context: vscode.ExtensionContext) {

	const rDocumentSelector = { scheme: 'file', language: 'r' } as vscode.DocumentSelector;

	context.subscriptions.push(
		vscode.languages.registerDocumentFormattingEditProvider(
			rDocumentSelector,
			new FormatterProvider
		)
	);
}

class FormatterProvider implements vscode.DocumentFormattingEditProvider {
	public provideDocumentFormattingEdits(document: vscode.TextDocument):
		vscode.ProviderResult<vscode.TextEdit[]> {
		return formatDocument(document);
	}
}

function formatDocument(document: vscode.TextDocument): vscode.TextEdit[] {
	if (!lastRuntimePath) {
		throw new Error(`No running R runtime to provide R package tasks.`);
	}

	// Just run in terminal for now:
	const terminal = vscode.window.createTerminal();
	terminal.sendText(`${lastRuntimePath}/R -e "styler::style_file('${document.fileName}')"`);

	// A terrible hack to return an empty edit:
	return [vscode.TextEdit.insert(document.lineAt(0).range.start, '')];
}

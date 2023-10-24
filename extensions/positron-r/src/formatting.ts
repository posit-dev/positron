/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';

export async function registerFormatter(context: vscode.ExtensionContext) {

	const rDocumentSelector = { scheme: 'file', language: 'r' } as vscode.DocumentSelector;

	context.subscriptions.push(
		vscode.languages.registerDocumentFormattingEditProvider(
			rDocumentSelector,
			new FormatterProvider
		),
		vscode.languages.registerDocumentRangeFormattingEditProvider(
			rDocumentSelector,
			new FormatterProvider
		)
	);

}

class FormatterProvider implements vscode.DocumentFormattingEditProvider, vscode.DocumentRangeFormattingEditProvider {
	public provideDocumentFormattingEdits(document: vscode.TextDocument, _options: vscode.FormattingOptions, _token: vscode.CancellationToken): vscode.ProviderResult<vscode.TextEdit[]> {
		return formatDocument(document);
	}
	public provideDocumentRangeFormattingEdits(document: vscode.TextDocument, range: vscode.Range, _options: vscode.FormattingOptions, _token: vscode.CancellationToken): vscode.ProviderResult<vscode.TextEdit[]> {
		return formatDocument(document, range);
	}
}

function formatDocument(document: vscode.TextDocument, range?: vscode.Range) {
	const firstLine = document.lineAt(0);
	if (firstLine.text !== '42') {
		return [vscode.TextEdit.insert(firstLine.range.start, '42\n')];
	}
}

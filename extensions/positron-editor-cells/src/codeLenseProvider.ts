/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';


export class CodeLensProvider implements vscode.CodeLensProvider {

	private codeLenses: vscode.CodeLens[] = [];
	private regex: RegExp;
	private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
	public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

	constructor() {
		this.regex = /(.+)/g;

		vscode.workspace.onDidChangeConfiguration((_) => {
			this._onDidChangeCodeLenses.fire();
		});
	}

	public provideCodeLenses(document: vscode.TextDocument, _token: vscode.CancellationToken): vscode.CodeLens[] | Thenable<vscode.CodeLens[]> {
		this.codeLenses = [];
		const regex = new RegExp(this.regex);
		const text = document.getText();
		let matches;
		while ((matches = regex.exec(text)) !== null) {
			const line = document.lineAt(document.positionAt(matches.index).line);
			const indexOf = line.text.indexOf(matches[0]);
			const position = new vscode.Position(line.lineNumber, indexOf);
			const range = document.getWordRangeAtPosition(position, new RegExp(this.regex));
			if (range) {
				this.codeLenses.push(new vscode.CodeLens(range, { title: 'Test', command: 'foo' }));
				// this.codeLenses.push(new vscode.CodeLens(range, { title: '$(run-above)', command: 'foo' }));
				// this.codeLenses.push(new vscode.CodeLens(range, { title: '$(run-below)', command: 'foo' }));
			}
		}
		return this.codeLenses;
	}

	public resolveCodeLens(codeLens: vscode.CodeLens, _token: vscode.CancellationToken): vscode.CodeLens {
		codeLens.command = {
			title: '$(run) Codelens provided by sample extension',
			tooltip: 'Tooltip provided by sample extension',
			command: 'codelens-sample.codelensAction',
			arguments: ['Argument 1', false]
		};
		return codeLens;
	}
}

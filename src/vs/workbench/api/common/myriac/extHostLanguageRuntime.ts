/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export class ExtHostLanguageRuntime {
	constructor() {
	}

	public registerLanguageRuntime(
		runtime: vscode.LanguageRuntime): vscode.Disposable {
		return new vscode.Disposable(() => { });
	}
}

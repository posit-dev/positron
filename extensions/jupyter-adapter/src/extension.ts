/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Api } from './Api';

export function activate(_context: vscode.ExtensionContext): vscode.Disposable {
	const channel = vscode.window.createOutputChannel('Jupyter Adapter');
	channel.appendLine('Jupyter Adapter extension activated');
	return new Api(channel);
}

export function deactivate() {
}

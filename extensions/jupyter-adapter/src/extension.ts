/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Api } from './Api';

export function activate(_context: vscode.ExtensionContext): vscode.Disposable {
	const channel = vscode.window.createOutputChannel('Jupyter Adapter');
	channel.appendLine('Jupyter Adapter extension activated');
	return new Api(_context, channel);
}

export function deactivate() {
}

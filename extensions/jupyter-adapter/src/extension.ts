/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Api } from './Api';

export function activate(context: vscode.ExtensionContext): vscode.Disposable {
	console.log('Starting Jupyter Adapter extension');
	return new Api();
}

export function deactivate() {
	console.log('Stopping Jupyter Adapter extension');
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
	console.log('Starting Jupyter Adapter extension');
}

export function deactivate() {
	console.log('Stopping Jupyter Adapter extension');
}

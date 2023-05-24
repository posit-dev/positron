/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { JupyterAdapterApiImpl } from './Api';
import { JupyterAdapterApi } from './jupyter-adapter';

export function activate(_context: vscode.ExtensionContext): JupyterAdapterApi {
	const channel = vscode.window.createOutputChannel('Jupyter Adapter');
	channel.appendLine('Jupyter Adapter extension activated');
	return new JupyterAdapterApiImpl(_context, channel);
}

export function deactivate() {
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { JupyterAdapterApiImpl } from './Api';
import { JupyterAdapterApi } from './jupyter-adapter';

/**
 * Versioned key for the Jupyter adapter workspace state.
 */
export const JUPYTER_WORKSPACE_STATE_KEY = 'jupyter-adapter.v1';

export function activate(_context: vscode.ExtensionContext): JupyterAdapterApi {
	const channel = vscode.window.createOutputChannel('Jupyter Adapter', { log: true });
	channel.appendLine('Jupyter Adapter extension activated');
	return new JupyterAdapterApiImpl(_context, channel);
}

export function deactivate() {
}

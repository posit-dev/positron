/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { NotebookDebugService } from './notebookDebugService.js';
import { RuntimeErrorViewer } from './runtimeErrorViewer.js';

export const log = vscode.window.createOutputChannel('Debugging', { log: true });

export function activate(context: vscode.ExtensionContext): void {
	context.subscriptions.push(log);

	const notebookDebugService = new NotebookDebugService();
	context.subscriptions.push(notebookDebugService);

	const runtimeErrorViewer = new RuntimeErrorViewer();
	context.subscriptions.push(runtimeErrorViewer);
}

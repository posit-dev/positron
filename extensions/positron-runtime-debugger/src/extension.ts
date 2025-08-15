/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { NotebookDebugService } from './notebookDebugService.js';
import { RuntimeErrorViewer } from './runtimeErrorViewer.js';
import { DisposableStore } from './util.js';

export const log = vscode.window.createOutputChannel('Debugging', { log: true });

export function activate(context: vscode.ExtensionContext): void {
	const disposables = new DisposableStore();
	context.subscriptions.push(disposables);

	disposables.add(log);
	disposables.add(new NotebookDebugService());
	disposables.add(new RuntimeErrorViewer());
}

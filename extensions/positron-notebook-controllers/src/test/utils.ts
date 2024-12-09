/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from 'sinon';
import * as vscode from 'vscode';

export function stubSetHasRunningNotebookSessionContext(disposables: vscode.Disposable[]): vscode.Event<boolean> {
	// An event that fires when the hasRunningNotebookSession context is set.
	const onDidSetPositronHasRunningNotebookSessionContext = new vscode.EventEmitter<boolean>();
	disposables.push(onDidSetPositronHasRunningNotebookSessionContext);

	// Stub vscode.commands.executeCommand.
	const executeCommand = vscode.commands.executeCommand;
	sinon.stub(vscode.commands, 'executeCommand')
		.callsFake(async (command, key, value) => {
			// If the context is being set, fire the event.
			if (command === 'setContext' && key === 'positron.hasRunningNotebookSession') {
				onDidSetPositronHasRunningNotebookSessionContext.fire(value);
			}

			// Forward the command to the original implementation.
			return executeCommand(command, key, value);
		});

	return onDidSetPositronHasRunningNotebookSessionContext.event;
}

export function eventToPromise<T>(event: vscode.Event<T>): Promise<T> {
	return new Promise<T>(resolve => {
		const disposable = event(e => {
			disposable.dispose();
			resolve(e);
		});
	});
}

export function closeAllEditors(): Thenable<any> {
	return vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

export async function openTestJupyterNotebookDocument(): Promise<void> {
	const notebookType = 'jupyter-notebook';
	const notebook = await vscode.workspace.openNotebookDocument(notebookType, {
		cells: [
			{ kind: vscode.NotebookCellKind.Code, languageId: 'text', value: '' }
		]
	});
	// TODO: Is the show needed too?
	await vscode.window.showNotebookDocument(notebook);
}

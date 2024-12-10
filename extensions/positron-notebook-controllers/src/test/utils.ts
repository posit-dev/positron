/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

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

export async function openTestJupyterNotebookDocument(languageId = 'text'): Promise<vscode.NotebookDocument> {
	const notebookType = 'jupyter-notebook';
	return await vscode.workspace.openNotebookDocument(notebookType, {
		metadata: {
			custom: {
				metadata: {
					language_info: {
						name: languageId,
					}
				}
			}
		},
		cells: [
			{ kind: vscode.NotebookCellKind.Code, languageId, value: 'code' },
			{ kind: vscode.NotebookCellKind.Code, languageId, value: 'more code' },
		],
	});
}

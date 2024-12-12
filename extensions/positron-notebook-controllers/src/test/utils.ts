/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { JUPYTER_NOTEBOOK_TYPE } from '../constants';

const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), { encoding: 'utf8' }));

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

export async function openTestJupyterNotebookDocument(languageId = 'text'): Promise<vscode.NotebookEditor> {
	const notebook = await vscode.workspace.openNotebookDocument(JUPYTER_NOTEBOOK_TYPE, {
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
	return await vscode.window.showNotebookDocument(notebook);
}

export async function selectNotebookController(id: string): Promise<void> {
	const extension = `${packageJson.publisher}.${packageJson.name}`;
	const context = { id, extension };
	const success = await vscode.commands.executeCommand('notebook.selectKernel', context) as boolean;
	if (!success) {
		throw new Error(`Failed to select controller '${extension}/${id}' for the active notebook.`);
	}
}

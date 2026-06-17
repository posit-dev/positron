/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { extensions, NotebookDocument, Uri, window, workspace, WorkspaceFolder } from 'vscode';
import { NotebookExportExtension } from '../positron-notebook-export.js';

export const extensionId = 'positron.notebook-export';

export function activeWorkspaceFolder(): WorkspaceFolder {
	const workspaceFolder = workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		throw new Error('No active workspace folder');
	}
	return workspaceFolder;
}

export function workspaceUri(...pathSegments: string[]): Uri {
	const workspaceFolder = activeWorkspaceFolder();
	return Uri.joinPath(workspaceFolder.uri, ...pathSegments);
}

export async function openAndShowWorkspaceNotebook(...pathSegments: string[]): Promise<NotebookDocument> {
	const uri = workspaceUri(...pathSegments);
	const notebook = await workspace.openNotebookDocument(uri);
	await window.showNotebookDocument(notebook);
	return notebook;
}

export async function activateExtension(): Promise<NotebookExportExtension> {
	const extension = extensions.getExtension<NotebookExportExtension>(extensionId);
	assert.ok(extension, `Extension ${extensionId} not found`);
	const api = await extension.activate();
	return api;
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { NotebookControllerManager } from './notebookControllerManager';
import { NotebookSessionService } from './notebookSessionService';

export const log = vscode.window.createOutputChannel('Positron Notebook Controllers', { log: true });

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const notebookSessionService = new NotebookSessionService();
	const manager = new NotebookControllerManager(notebookSessionService);
	context.subscriptions.push(manager);

	// Register notebook controllers for newly registered runtimes.
	context.subscriptions.push(positron.runtime.onDidRegisterRuntime((runtime) => {
		if (!manager.controllers.has(runtime.languageId)) {
			manager.createNotebookController(runtime.languageId);
		}
	}));

	// Register notebook controllers for existing runtimes.
	for (const runtime of await positron.runtime.getRegisteredRuntimes()) {
		if (!manager.controllers.has(runtime.languageId)) {
			manager.createNotebookController(runtime.languageId);
		}
	}

	// Update notebook affinity when a notebook is opened.
	context.subscriptions.push(vscode.workspace.onDidOpenNotebookDocument(async (notebook) => {
		manager.updateNotebookAffinity(notebook);
	}));

	// Update notebook affinity for notebooks that are already opened.
	for (const notebook of vscode.workspace.notebookDocuments) {
		manager.updateNotebookAffinity(notebook);
	}
}

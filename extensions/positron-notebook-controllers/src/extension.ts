/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { NotebookControllerManager } from './notebookControllerManager';
import { NotebookSessionService } from './notebookSessionService';
import { registerCommands } from './commands';

export const log = vscode.window.createOutputChannel('Positron Notebook Controllers', { log: true });

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const notebookSessionService = new NotebookSessionService();

	// Shutdown any running sessions when a notebook is closed.
	context.subscriptions.push(vscode.workspace.onDidCloseNotebookDocument(async (notebook) => {
		log.debug(`Notebook closed: ${notebook.uri.path}`);
		if (notebookSessionService.hasStartingOrRunningNotebookSession(notebook.uri)) {
			await notebookSessionService.shutdownRuntimeSession(notebook.uri);
		}
	}));

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

	// TODO: For some unknown reason, if this is not async, the onDidCloseNotebookDocument event
	// doesn't fire for the notebook. Maybe this causes a reference to the notebook that prevents
	// it from being disposed?
	vscode.window.onDidChangeActiveNotebookEditor(async (editor) => {
		const notebook = editor?.notebook;
		setHasRunningNotebookSessionContext(
			notebook ? notebookSessionService.hasRunningNotebookSession(notebook.uri) : false
		);
	});

	registerCommands(context, notebookSessionService);
}

export function setHasRunningNotebookSessionContext(value: boolean): void {
	log.debug(`Setting 'positron.hasRunningNotebookSession' context to: ${value}`);
	vscode.commands.executeCommand(
		'setContext',
		'positron.hasRunningNotebookSession',
		value,
	);
}

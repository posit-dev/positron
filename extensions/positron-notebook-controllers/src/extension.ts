/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { NotebookControllerManager } from './notebookControllerManager';
import { NotebookSessionService } from './notebookSessionService';
import { registerCommands } from './commands';
import { JUPYTER_NOTEBOOK_TYPE } from './constants';

export const log = vscode.window.createOutputChannel('Positron Notebook Controllers', { log: true });

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const notebookSessionService = new NotebookSessionService();
	context.subscriptions.push(notebookSessionService);

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
	context.subscriptions.push(positron.runtime.onDidRegisterRuntime((runtimeMetadata) => {
		if (!manager.controllers.has(runtimeMetadata.runtimeId)) {
			manager.createNotebookController(runtimeMetadata);
		}
	}));

	// Register notebook controllers for existing runtimes.
	for (const runtimeMetadata of await positron.runtime.getRegisteredRuntimes()) {
		if (!manager.controllers.has(runtimeMetadata.runtimeId)) {
			manager.createNotebookController(runtimeMetadata);
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

	// Set the hasRunningNotebookSession context when the active notebook editor changes.
	vscode.window.onDidChangeActiveNotebookEditor((editor) => {
		const value = notebookSessionService.hasRunningNotebookSession(editor?.notebook.uri);
		setHasRunningNotebookSessionContext(value);
	});

	// Set the hasRunningNotebookSession context when a session is started/shutdown for the active notebook.
	context.subscriptions.push(notebookSessionService.onDidChangeNotebookSession((e) => {
		if (e.notebookUri === vscode.window.activeNotebookEditor?.notebook.uri) {
			setHasRunningNotebookSessionContext(!!e.session);
		}
	}));

	// Register kernel source action providers for the kernel selection quickpick.
	context.subscriptions.push(vscode.notebooks.registerKernelSourceActionProvider(JUPYTER_NOTEBOOK_TYPE, {
		provideNotebookKernelSourceActions: () => {
			return [
				{
					label: 'Python Environments...',
					command: 'positron.notebooks.selectPythonEnvironment',
				},
				{
					label: 'R Environments...',
					command: 'positron.notebooks.selectREnvironment'
				}
			];
		}
	}));

	registerCommands(context, notebookSessionService);
}

function setHasRunningNotebookSessionContext(value: boolean): void {
	log.debug(`Setting 'positron.hasRunningNotebookSession' context to: ${value}`);
	vscode.commands.executeCommand(
		'setContext',
		'positron.hasRunningNotebookSession',
		value,
	);
}

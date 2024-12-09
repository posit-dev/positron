/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { NotebookControllerManager } from './notebookControllerManager';
import { NotebookSessionService } from './notebookSessionService';
import { registerCommands } from './commands';
import { JUPYTER_NOTEBOOK_TYPE } from './constants';
import { registerExecutionInfoStatusBar } from './statusBar';
import { getNotebookSession, isActiveNotebookEditorUri } from './utils';

export const log = vscode.window.createOutputChannel('Positron Notebook Controllers', { log: true });

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const notebookSessionService = new NotebookSessionService();

	// Shutdown any running sessions when a notebook is closed.
	context.subscriptions.push(vscode.workspace.onDidCloseNotebookDocument(async (notebook) => {
		log.debug(`Notebook closed: ${notebook.uri.path}`);

		updateHasRunningNotebookSessionContext(notebook.uri, undefined);

		await notebookSessionService.shutdownRuntimeSession(notebook.uri);
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
	context.subscriptions.push(vscode.window.onDidChangeActiveNotebookEditor(async (editor) => {
		const uri = editor?.notebook.uri;
		if (uri) {
			const session = await getNotebookSession(uri);
			updateHasRunningNotebookSessionContext(uri, session);
		}
	}));

	// Set the hasRunningNotebookSession context for the current active notebook editor.
	const activeNotebookUri = vscode.window.activeNotebookEditor?.notebook.uri;
	if (activeNotebookUri) {
		const session = await getNotebookSession(activeNotebookUri);
		updateHasRunningNotebookSessionContext(activeNotebookUri, session);
	}

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

	registerExecutionInfoStatusBar(context.subscriptions, manager);
}

export function updateHasRunningNotebookSessionContext(
	notebookUri: vscode.Uri, session: positron.LanguageRuntimeSession | undefined,
): void {
	// If this is the active notebook editor, update the hasRunningNotebookSession context.
	if (isActiveNotebookEditorUri(notebookUri)) {
		const hasRunningNotebookSession = Boolean(session);
		log.debug(`Setting 'positron.hasRunningNotebookSession' context to: ${hasRunningNotebookSession}`);
		vscode.commands.executeCommand(
			'setContext',
			'positron.hasRunningNotebookSession',
			hasRunningNotebookSession,
		);
	}
}

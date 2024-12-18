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

export const log = vscode.window.createOutputChannel('Notebook Controllers', { log: true });

const _onDidSetHasRunningNotebookSessionContext = new vscode.EventEmitter<boolean>();

/**
 * An event that fires when the hasRunningNotebookSessionContext is set.
 * Currently only for testing purposes.
 */
export const onDidSetHasRunningNotebookSessionContext = _onDidSetHasRunningNotebookSessionContext.event;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	// If experimental runtime notebook kernels are enabled, exit early.
	const enableRuntimeNotebookKernel = vscode.workspace.getConfiguration().get<boolean>('positron.runtimeNotebookKernel.enable');
	if (enableRuntimeNotebookKernel) {
		return;
	}

	context.subscriptions.push(_onDidSetHasRunningNotebookSessionContext);

	const notebookSessionService = new NotebookSessionService();

	// Shutdown any running sessions when a notebook is closed.
	context.subscriptions.push(vscode.workspace.onDidCloseNotebookDocument(async (notebook) => {
		log.debug(`Notebook closed: ${notebook.uri.path}`);
		if (isActiveNotebookEditorUri(notebook.uri)) {
			await setHasRunningNotebookSessionContext(false);
		}
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
		if (editor) {
			// Changed to a notebook editor.
			const notebookUri = editor.notebook.uri;
			const session = await getNotebookSession(notebookUri);
			await setHasRunningNotebookSessionContext(Boolean(session));
		} else {
			// Changed to a non-notebook editor.
			await setHasRunningNotebookSessionContext(false);
		}
	}));

	// Set the hasRunningNotebookSession context for the current active notebook editor.
	if (vscode.window.activeNotebookEditor) {
		const notebookUri = vscode.window.activeNotebookEditor.notebook.uri;
		const session = await getNotebookSession(notebookUri);
		await setHasRunningNotebookSessionContext(Boolean(session));
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

	registerCommands(context.subscriptions);

	registerExecutionInfoStatusBar(context.subscriptions, manager);
}

export function setHasRunningNotebookSessionContext(value: boolean): Thenable<unknown> {
	_onDidSetHasRunningNotebookSessionContext.fire(value);
	return vscode.commands.executeCommand(
		'setContext',
		'positron.hasRunningNotebookSession',
		value,
	);
}

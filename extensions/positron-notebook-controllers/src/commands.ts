/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { getNotebookSession, isActiveNotebookEditorUri } from './utils';
import { setHasRunningNotebookSessionContext } from './extension';

export function registerCommands(disposables: vscode.Disposable[]): void {
	disposables.push(vscode.commands.registerCommand('positron.restartKernel', async () => {
		// Get the active notebook.
		const notebook = vscode.window.activeNotebookEditor?.notebook;
		if (!notebook) {
			throw new Error('No active notebook. This command should only be available when a notebook is active.');
		}

		// Get the session for the active notebook.
		const session = await getNotebookSession(notebook.uri);
		if (!session) {
			throw new Error('No session found for active notebook. This command should only be available when a session is running.');
		}

		// Disable the hasRunningNotebookSession context before restarting.
		if (isActiveNotebookEditorUri(notebook.uri)) {
			await setHasRunningNotebookSessionContext(false);
		}

		// Restart the session with a progress bar.
		try {
			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: vscode.l10n.t("Restarting {0} interpreter for '{1}'", session.runtimeMetadata.runtimeName, notebook.uri.path),
			}, () => positron.runtime.restartSession(session.metadata.sessionId));

			// Enable the hasRunningNotebookSession context.
			if (isActiveNotebookEditorUri(notebook.uri)) {
				await setHasRunningNotebookSessionContext(true);
			}
		} catch (error) {
			vscode.window.showErrorMessage(
				vscode.l10n.t("Restarting {0} interpreter for '{1}' failed. Reason: {2}",
					session.runtimeMetadata.runtimeName, notebook.uri.path, error.message));
		}
	}), vscode.commands.registerCommand('positron.notebooks.selectPythonEnvironment', async () => {
		return await vscode.commands.executeCommand('workbench.action.languageRuntime.pick', 'python');
	}), vscode.commands.registerCommand('positron.notebooks.selectREnvironment', async () => {
		return await vscode.commands.executeCommand('workbench.action.languageRuntime.pick', 'r');
	}));
}

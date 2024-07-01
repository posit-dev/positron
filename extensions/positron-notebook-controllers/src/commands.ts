/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { NotebookSessionService } from './notebookSessionService';

export function registerCommands(context: vscode.ExtensionContext, notebookSessionService: NotebookSessionService): void {
	context.subscriptions.push(vscode.commands.registerCommand('positron.restartKernel', async () => {
		// Get the active notebook.
		const notebook = vscode.window.activeNotebookEditor?.notebook;
		if (!notebook) {
			throw new Error('No active notebook. This command should only be available when a notebook is active.');
		}

		// Get the session for the active notebook.
		const session = notebookSessionService.getNotebookSession(notebook.uri);
		if (!session) {
			throw new Error('No session found for active notebook. This command should only be available when a session is running.');
		}

		// Restart the session with a progress bar.
		try {
			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: vscode.l10n.t("Restarting {0} interpreter for '{1}'", session.runtimeMetadata.languageName, notebook.uri.path),
			}, () => notebookSessionService.restartRuntimeSession(notebook.uri));
		} catch (error) {
			vscode.window.showErrorMessage(
				vscode.l10n.t("Restarting {0} interpreter for '{1}' failed. Reason: {2}",
					session.runtimeMetadata.languageName, notebook.uri.path, error.message));
		}
	}), vscode.commands.registerCommand('positron.notebooks.selectPythonEnvironment', async () => {
		return await vscode.commands.executeCommand('workbench.action.languageRuntime.pick', 'python');
	}), vscode.commands.registerCommand('positron.notebooks.selectREnvironment', async () => {
		return await vscode.commands.executeCommand('workbench.action.languageRuntime.pick', 'r');
	}));
}

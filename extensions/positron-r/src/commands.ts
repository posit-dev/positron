/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';

import { adaptJupyterKernel } from './kernel';

export function registerCommands(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		// Command used to register the ARK kernel with the Jupyter Adapter
		// extension. Typically run only once to set up the kernel.
		vscode.commands.registerCommand('r.setKernelPath', () => {
			// Get the existing kernel path setting
			const settingPath = vscode.workspace.getConfiguration('positron.r').get<string>('kernel.path');

			// Prompt the user to select a file
			vscode.window.showOpenDialog({
				canSelectFiles: true,
				canSelectFolders: false,
				canSelectMany: false,
				defaultUri: settingPath ? vscode.Uri.file(settingPath) : undefined,
				openLabel: 'Select Kernel'
			}).then((kernelPaths) => {
				if (kernelPaths && kernelPaths.length > 0) {
					// Only use the first file selected (there should only be one!)
					const fsPath = kernelPaths[0].fsPath;

					// Update the setting with the value the user entered
					vscode.workspace.getConfiguration('positron.r').update('kernel.path', fsPath, true);

					// Register the kernel with the Jupyter Adapter extension
					adaptJupyterKernel(context, fsPath);
				}
			});
		}),

		// Command used to create new R files
		vscode.commands.registerCommand('r.createNewFile', () => {
			vscode.workspace.openTextDocument({ language: 'r' }).then((newFile) => {
				vscode.window.showTextDocument(newFile);
			});
		}),

		// Command used to source the current file
		vscode.commands.registerCommand('r.sourceCurrentFile', () => {
			// Get the active text editor
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				// No editor; nothing to do
				return;
			}

			const filePath = editor.document.uri.fsPath;
			if (!filePath) {
				// File is unsaved; show a warning
				vscode.window.showWarningMessage('Cannot source unsaved file.');
				return;
			}

			// In the future, we will want to shorten the path by making it
			// relative to the current directory; doing so, however, will
			// require the kernel to alert us to the current working directory,
			// or provide a method for asking it to create the `source()`
			// command. For now, just use the full path.
			const command = `source('${filePath}')`;
			positron.runtime.executeCode('r', command, true);
		}),
	);
}

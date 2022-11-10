/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import { adaptJupyterKernel } from './kernel';

export function registerCommands(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		// Command used to register the ARK kernel with the Jupyter Adapter
		// extension. Typically run only once to set up the kernel.
		vscode.commands.registerCommand('positronR.setKernelPath', () => {
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
		}));
}

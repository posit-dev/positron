/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import { adaptJupyterKernel } from './kernel';

export function registerCommands(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		// Command used to register the ARK kernel with the Jupyter Adapter
		// extension. Typically run only once to set up the kernel.
		vscode.commands.registerCommand('ark.setKernelPath', () => {
			// Get the existing kernel path setting
			const settingPath = vscode.workspace.getConfiguration('ark').get<string>('kernelPath');

			// Prompt the user to enter the new kernel path string
			vscode.window.showInputBox({
				prompt: 'Enter the path to the ARK kernel executable',
				value: settingPath
			}).then((kernelPath) => {
				if (kernelPath) {
					// Update the setting with the value the user entered
					vscode.workspace.getConfiguration('ark').update('kernelPath', kernelPath, true);

					// Register the kernel with the Jupyter Adapter extension
					adaptJupyterKernel(context, kernelPath);
				}
			});
		}));
}

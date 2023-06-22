/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';

import { adaptJupyterKernel } from './kernel';

export async function registerCommands(context: vscode.ExtensionContext) {

	const isRPackage = await detectRPackage();
	vscode.commands.executeCommand('setContext', 'isRPackage', isRPackage);

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

		vscode.commands.registerCommand('r.packageLoad', () => {
			positron.runtime.executeCode('r', 'devtools::load_all()', true);
		}),

		vscode.commands.registerCommand('r.packageBuild', () => {
			positron.runtime.executeCode('r', 'devtools::build()', true);
		}),

		vscode.commands.registerCommand('r.packageTest', () => {
			positron.runtime.executeCode('r', 'devtools::test()', true);
		}),

		vscode.commands.registerCommand('r.packageCheck', () => {
			positron.runtime.executeCode('r', 'devtools::check()', true);
		})

	);
}

async function detectRPackage(): Promise<boolean> {
	if (vscode.workspace.workspaceFolders !== undefined) {
		const folderUri = vscode.workspace.workspaceFolders[0].uri;
		const fileUri = vscode.Uri.joinPath(folderUri, 'DESCRIPTION');
		try {
			const bytes = await vscode.workspace.fs.readFile(fileUri);
			const descriptionText = Buffer.from(bytes).toString('utf8');
			const descriptionLines = descriptionText.split(/(\r?\n)/);
			const descStartsWithPackage = descriptionLines[0].startsWith('Package:');
			const typeLines = descriptionLines.filter(line => line.startsWith('Type:'));
			const typeIsPackage = typeLines.length === 0 || typeLines[0].includes('Package');
			return descStartsWithPackage && typeIsPackage;
		} catch { }
	}
	return false;
}

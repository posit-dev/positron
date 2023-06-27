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

		// Commands for package development tooling
		vscode.commands.registerCommand('r.packageLoad', () => {
			positron.runtime.executeCode('r', 'devtools::load_all()', true);
		}),

		vscode.commands.registerCommand('r.packageBuild', () => {
			positron.runtime.executeCode('r', 'devtools::build()', true);
		}),

		vscode.commands.registerCommand('r.packageInstall', () => {
			positron.runtime.executeCode('r', 'devtools::install()', true);
		}),

		vscode.commands.registerCommand('r.packageTest', () => {
			positron.runtime.executeCode('r', 'devtools::test()', true);
		}),

		vscode.commands.registerCommand('r.packageCheck', () => {
			positron.runtime.executeCode('r', 'devtools::check()', true);
		}),

		vscode.commands.registerCommand('r.packageDocument', () => {
			positron.runtime.executeCode('r', 'devtools::document()', true);
		}),

		// Command used to source the current file
		vscode.commands.registerCommand('r.sourceCurrentFile', async () => {
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

			// Save the file before sourcing it to ensure that the contents are
			// up to date with editor buffer.
			await vscode.commands.executeCommand('workbench.action.files.save');

			try {
				// Check to see if the fsPath is an actual path to a file using
				// the VS Code file system API.
				const fsStat = await vscode.workspace.fs.stat(vscode.Uri.file(filePath));

				// In the future, we will want to shorten the path by making it
				// relative to the current directory; doing so, however, will
				// require the kernel to alert us to the current working directory,
				// or provide a method for asking it to create the `source()`
				// command.
				//
				// For now, just use the full path, passed through JSON encoding
				// to ensure that it is properly escaped.
				if (fsStat) {
					const command = `source(${JSON.stringify(filePath)})`;
					positron.runtime.executeCode('r', command, true);
				}
			} catch (e) {
				// This is not a valid file path, which isn't an error; it just
				// means the active editor has something loaded into it that
				// isn't a file on disk.  In Positron, there is currently a bug
				// which causes the REPL to act like an active editor. See:
				//
				// https://github.com/rstudio/positron/issues/780
			}
		}),
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

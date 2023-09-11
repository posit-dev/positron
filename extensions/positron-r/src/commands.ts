/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { delay } from './util';

export async function registerCommands(context: vscode.ExtensionContext) {

	const isRPackage = await detectRPackage();
	vscode.commands.executeCommand('setContext', 'isRPackage', isRPackage);

	context.subscriptions.push(

		// Command used to create new R files
		vscode.commands.registerCommand('r.createNewFile', () => {
			vscode.workspace.openTextDocument({ language: 'r' }).then((newFile) => {
				vscode.window.showTextDocument(newFile);
			});
		}),

		vscode.commands.registerCommand('r.insertPipe', () => {
			const extConfig = vscode.workspace.getConfiguration('positron.r');
			const pipeString = extConfig.get<string>('pipe') || '|>';
			vscode.commands.executeCommand('type', { text: ` ${pipeString} ` });
		}),

		vscode.commands.registerCommand('r.insertLeftAssignment', () => {
			vscode.commands.executeCommand('type', { text: ' <- ' });
		}),

		// Commands for package development tooling
		vscode.commands.registerCommand('r.packageLoad', () => {
			positron.runtime.executeCode('r', 'devtools::load_all()', true);
		}),

		vscode.commands.registerCommand('r.packageBuild', () => {
			positron.runtime.executeCode('r', 'devtools::build()', true);
		}),

		vscode.commands.registerCommand('r.packageInstall', async () => {
			const packageName = await getRPackageName();
			const runningRuntimes = await positron.runtime.getRunningRuntimes('r');
			if (!runningRuntimes || !runningRuntimes.length) {
				vscode.window.showWarningMessage('Cannot install package as there is no R interpreter running.');
				return;
			}

			// For now, there will be only one running R runtime:
			const runtimePath = runningRuntimes[0].runtimePath;
			const originalTimeStamp = getPackageDescriptionTimestamp(runtimePath, packageName);
			positron.runtime.executeCode('r', 'devtools::install()', true);
			await pollForNewTimestamp(runtimePath, packageName, originalTimeStamp);
			positron.runtime.restartLanguageRuntime(runningRuntimes[0].runtimeId);
			positron.runtime.executeCode('r', `library(${packageName})`, true);
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
				// https://github.com/posit-dev/positron/issues/780
			}
		}),
	);
}

async function detectRPackage(): Promise<boolean> {
	const descriptionLines = await parseRPackageDescription();
	const packageLines = descriptionLines.filter(line => line.startsWith('Package:'));
	const typeLines = descriptionLines.filter(line => line.startsWith('Type:'));
	const typeIsPackage = (typeLines.length > 0
		? typeLines[0].toLowerCase().includes('package')
		: false);
	const typeIsPackageOrMissing = typeLines.length === 0 || typeIsPackage;
	return packageLines.length > 0 && typeIsPackageOrMissing;
}

async function getRPackageName(): Promise<string> {
	const descriptionLines = await parseRPackageDescription();
	const packageLines = descriptionLines.filter(line => line.startsWith('Package:'))[0];
	const packageName = packageLines.split(' ').slice(-1)[0];
	return packageName;
}

async function parseRPackageDescription(): Promise<string[]> {
	if (vscode.workspace.workspaceFolders !== undefined) {
		const folderUri = vscode.workspace.workspaceFolders[0].uri;
		const fileUri = vscode.Uri.joinPath(folderUri, 'DESCRIPTION');
		try {
			const bytes = await vscode.workspace.fs.readFile(fileUri);
			const descriptionText = Buffer.from(bytes).toString('utf8');
			const descriptionLines = descriptionText.split(/(\r?\n)/);
			return descriptionLines;
		} catch { }
	}
	return [''];
}

function getPackageDescriptionTimestamp(runtimePath: string, packageName: string): number | null {
	const path = require('path');
	const fs = require('fs');
	const libraryPath = path.join(runtimePath, 'library', packageName, 'DESCRIPTION');
	try {
		const stats = fs.statSync(libraryPath);
		return stats.mtimeMs;
	} catch { }
	return null;
}

async function pollForNewTimestamp(runtimePath: string, packageName: string, oldTimestamp: number | null) {
	const path = require('path');
	const fs = require('fs');
	const timeout = Date.now() + 3e5;

	if (oldTimestamp === null) {
		const libraryPath = path.join(runtimePath, 'library', packageName, 'DESCRIPTION');
		while (!fs.existsSync(libraryPath) && Date.now() < timeout) {
			await delay(1000);
		}
	} else {
		let newTimeStamp = getPackageDescriptionTimestamp(runtimePath, packageName);
		while (newTimeStamp !== null && !(newTimeStamp > oldTimestamp) && Date.now() < timeout) {
			await delay(1000);
			newTimeStamp = getPackageDescriptionTimestamp(runtimePath, packageName);
		}
	}
}

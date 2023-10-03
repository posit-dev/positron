/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { delay } from './util';
import { RRuntime } from './runtime';
import { getRPackageName } from './contexts';
import { getRPackageTasks } from './tasks';
import { randomUUID } from 'crypto';

export async function registerCommands(context: vscode.ExtensionContext, runtimes: Map<string, RRuntime>) {

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
			const runtime = runtimes.get(runningRuntimes[0].runtimeId);
			if (runtime) {
				const id = randomUUID();
				runtime.execute('devtools::install()',
					id,
					positron.RuntimeCodeExecutionMode.Interactive,
					positron.RuntimeErrorBehavior.Continue);
				const disp1 = runtime.onDidReceiveRuntimeMessage(runtimeMessage => {
					if (runtimeMessage.parent_id === id &&
						runtimeMessage.type === positron.LanguageRuntimeMessageType.State) {
						const runtimeMessageState = runtimeMessage as positron.LanguageRuntimeState;
						if (runtimeMessageState.state === positron.RuntimeOnlineState.Idle) {
							positron.runtime.restartLanguageRuntime(runtime.metadata.runtimeId);
							disp1.dispose();
						}
					}
				});
				const disp2 = runtime.onDidChangeRuntimeState(async runtimeState => {
					if (runtimeState === positron.RuntimeState.Starting) {
						await delay(500);
						runtime.execute(`library(${packageName})`,
							randomUUID(),
							positron.RuntimeCodeExecutionMode.Interactive,
							positron.RuntimeErrorBehavior.Continue);
						disp2.dispose();
					}
				});
			} else {
				throw new Error(`R runtime '${runningRuntimes[0].runtimeId}' is not registered in the extension host`);
			}
		}),

		vscode.commands.registerCommand('r.packageTest', () => {
			positron.runtime.executeCode('r', 'devtools::test()', true);
		}),

		vscode.commands.registerCommand('r.packageCheck', async () => {
			const tasks = await getRPackageTasks();
			const task = tasks.filter(task => task.name === 'Check R package')[0];
			vscode.tasks.executeTask(task);
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

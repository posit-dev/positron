/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { timeout } from './util';
import { getRunningRRuntime, checkInstalled } from './runtime';
import { getRPackageName } from './contexts';
import { getRPackageTasks } from './tasks';
import { randomUUID } from 'crypto';

export async function registerCommands(context: vscode.ExtensionContext) {

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
			insertOperatorWithSpace(pipeString);
		}),

		vscode.commands.registerCommand('r.insertSection', () => {
			insertSection();
		}),

		// TODO: remove this hack when we can address the Console like an editor
		vscode.commands.registerCommand('r.insertPipeConsole', () => {
			const extConfig = vscode.workspace.getConfiguration('positron.r');
			const pipeString = extConfig.get<string>('pipe') || '|>';
			vscode.commands.executeCommand('type', { text: ` ${pipeString} ` });
		}),

		vscode.commands.registerCommand('r.insertLeftAssignment', () => {
			insertOperatorWithSpace('<-');
		}),

		// TODO: remove this hack when we can address the Console like an editor
		vscode.commands.registerCommand('r.insertLeftAssignmentConsole', () => {
			vscode.commands.executeCommand('type', { text: ' <- ' });
		}),

		// Commands for package development tooling
		vscode.commands.registerCommand('r.packageLoad', async () => {
			executeCodeForCommand('devtools', 'devtools::load_all()');
		}),

		vscode.commands.registerCommand('r.packageBuild', async () => {
			executeCodeForCommand('devtools', 'devtools::build()');
		}),

		vscode.commands.registerCommand('r.packageInstall', async () => {
			const packageName = await getRPackageName();
			const tasks = await getRPackageTasks();
			const task = tasks.filter(task => task.definition.task === 'r.task.packageInstall')[0];
			const isInstalled = await checkInstalled(task.definition.pkg);
			if (!isInstalled) {
				return;
			}
			const runtime = await getRunningRRuntime();

			const execution = await vscode.tasks.executeTask(task);
			const disp1 = vscode.tasks.onDidEndTaskProcess(async e => {
				if (e.execution === execution) {
					if (e.exitCode === 0) {
						vscode.commands.executeCommand('workbench.panel.positronConsole.focus');
						try {
							await positron.runtime.restartLanguageRuntime(runtime.metadata.runtimeId);
						} catch {
							// If restarting promise rejects, dispose of listener:
							disp1.dispose();
						}

						// A promise that resolves when the runtime is ready:
						const promise = new Promise<void>(resolve => {
							const disp2 = runtime.onDidChangeRuntimeState(runtimeState => {
								if (runtimeState === positron.RuntimeState.Ready) {
									resolve();
									disp2.dispose();
								}
							});
						});

						// Wait for the the runtime to be ready, or for a timeout:
						await Promise.race([promise, timeout(1e4, 'waiting for R to be ready')]);
						runtime.execute(`library(${packageName})`,
							randomUUID(),
							positron.RuntimeCodeExecutionMode.Interactive,
							positron.RuntimeErrorBehavior.Continue);
					}
					disp1.dispose();
				}
			});
		}),

		vscode.commands.registerCommand('r.packageTest', async () => {
			executeCodeForCommand('devtools', 'devtools::test()');
		}),

		vscode.commands.registerCommand('r.useTestthat', async () => {
			executeCodeForCommand('usethis', 'usethis::use_testthat()');
		}),

		vscode.commands.registerCommand('r.useTest', async () => {
			executeCodeForCommand('usethis', 'usethis::use_test("rename-me")');
		}),

		vscode.commands.registerCommand('r.packageCheck', async () => {
			const tasks = await getRPackageTasks();
			const task = tasks.filter(task => task.definition.task === 'r.task.packageCheck')[0];
			const isInstalled = await checkInstalled(task.definition.pkg);
			if (isInstalled) {
				vscode.tasks.executeTask(task);
			}
		}),

		vscode.commands.registerCommand('r.packageDocument', async () => {
			executeCodeForCommand('devtools', 'devtools::document()');
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

function insertOperatorWithSpace(op: string) {
	// TODO: make this work in the Console too
	if (!vscode.window.activeTextEditor) {
		return;
	}
	const editor = vscode.window.activeTextEditor;
	// make sure cursor ends up on RHS, even if selection was made right-to-left
	editor.selections = editor.selections.map(s => new vscode.Selection(s.start, s.end));

	return editor.edit(editBuilder => {
		editor.selections.forEach(sel => {
			const startPos = sel.start;
			const endPos = sel.end;
			const lineText = editor.document.lineAt(startPos).text;
			let insertValue = op;

			const precedingChar = lineText.charAt(startPos.character - 1);
			if (!/\s/g.test(precedingChar)) {
				insertValue = ' ' + insertValue;
			}

			const followingChar = lineText.charAt(endPos.character);
			if (!/\s/g.test(followingChar)) {
				insertValue = insertValue + ' ';
			}

			editBuilder.replace(sel, insertValue);
		});
	});
}

/**
 * Inserts a named section into the editor, attempting to emulate the
 * behavior of RStudio's "Insert Section" command.
 *
 * Note that the keybinding this command doesn't match RStudio's by default since
 * the default keybinding for "Insert Section" in VS Code is already used
 * for Search Again. The RStudio Keymap extension can be used to restore the
 * original binding (Cmd+Shift+R).
 *
 * @see https://docs.posit.co/ide/user/ide/guide/code/code-sections.html#code-sections
 */
function insertSection() {
	vscode.window.showInputBox({
		placeHolder: vscode.l10n.t('Section label'),
		prompt: vscode.l10n.t('Enter the name of the section to insert'),
	}).then((sectionName) => {
		if (sectionName) {
			// Get the active text editor. The 'insertSection' command only
			// lights up when an R editor is focused, so we expect this to
			// always be defined.
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				return;
			}

			// If the user has rulers enabled, we want to make sure the section
			// header is aligned with the rulers; otherwise, just use a standard
			// 80 character limit.
			//
			// Let the section header run up to 5 characters short of the first
			// ruler.
			const config = vscode.workspace.getConfiguration('editor');
			const rulers = config.get<Array<number>>('rulers');
			const targetWidth = rulers && rulers.length > 0 ? rulers[0] - 5 : 75;

			// Get the current selection and text.
			const selection = editor.selection;
			const text = editor.document.getText(selection);

			// Create the section header.
			let section = '\n# ' + sectionName + ' ';

			if (targetWidth - section.length < 4) {
				// A section header must have at least 4 dashes
				section += '----';
			} else {
				// Add dashes up to the target width.
				for (let i = section.length; i < targetWidth; i++) {
					section += '-';
				}
			}
			section += '\n\n';

			editor.edit((editBuilder) => {
				editBuilder.replace(selection, text + section);
			});
		}
	});
}

async function executeCodeForCommand(pkg: string, code: string) {
	const isInstalled = await checkInstalled(pkg);
	if (isInstalled) {
		positron.runtime.executeCode('r', code, true);
	}
}

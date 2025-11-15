/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { generateDirectInjectionId, PromiseHandles } from './util';
import { checkInstalled } from './session';
import { getRPackageName } from './contexts';
import { getRPackageTasks } from './tasks';
import { randomUUID } from 'crypto';
import { RSessionManager } from './session-manager';
import { quickPickRuntime } from './runtime-quickpick';
import { MINIMUM_RENV_VERSION, MINIMUM_R_VERSION } from './constants';
import { RRuntimeManager } from './runtime-manager';
import { RMetadataExtra } from './r-installation';
import { onDidDiscoverTestFiles } from './testing/testing';
import { LOGGER } from './extension.js';
import { printInterpreterSettingsInfo } from './interpreter-settings.js';

export async function registerCommands(context: vscode.ExtensionContext, runtimeManager: RRuntimeManager) {

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
		// In the meantime, note the use of the command 'default:type' instead of 'type'.
		// This works around the fact that the vim plugin overrides the 'type' command.
		// https://github.com/posit-dev/positron/issues/3279
		vscode.commands.registerCommand('r.insertPipeConsole', () => {
			const extConfig = vscode.workspace.getConfiguration('positron.r');
			const pipeString = extConfig.get<string>('pipe') || '|>';
			vscode.commands.executeCommand('default:type', { text: ` ${pipeString} ` });
		}),

		vscode.commands.registerCommand('r.insertLeftAssignment', () => {
			insertOperatorWithSpace('<-');
		}),

		// TODO: remove this hack when we can address the Console like an editor
		vscode.commands.registerCommand('r.insertLeftAssignmentConsole', () => {
			vscode.commands.executeCommand('default:type', { text: ' <- ' });
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
			const session = RSessionManager.instance.getConsoleSession();
			if (!session) {
				return;
			}

			const execution = await vscode.tasks.executeTask(task);
			const disp1 = vscode.tasks.onDidEndTaskProcess(async e => {
				if (e.execution === execution) {
					if (e.exitCode === 0) {
						vscode.commands.executeCommand('workbench.panel.positronConsole.focus');

						// A promise that resolves when the runtime is ready.
						// We establish this promise before the session has
						// restarted so that we can ensure that we don't miss
						// the Ready state.
						const promise = new PromiseHandles<void>();
						const disp2 = session.onDidChangeRuntimeState(runtimeState => {
							if (runtimeState === positron.RuntimeState.Ready) {
								promise.resolve();
								disp2.dispose();
							}
						});

						try {
							await positron.runtime.restartSession(session.metadata.sessionId);
						} catch (err) {
							// If restarting promise rejects, dispose of listeners, notify user, and reject.
							disp1.dispose();
							disp2.dispose();
							promise.reject(err);
							vscode.window.showErrorMessage(vscode.l10n.t('Failed to restart R after installing R package: {0}', JSON.stringify(err)));
							return;
						}

						// Temporary measure - generate a direct injection ID so this code execution will be added to the console history.
						session.execute(`library(${packageName})`,
							generateDirectInjectionId(),
							positron.RuntimeCodeExecutionMode.Interactive,
							positron.RuntimeErrorBehavior.Continue);
					}
					disp1.dispose();
				}
			});
		}),

		vscode.commands.registerCommand('r.packageTest', async () => {
			const tasks = await getRPackageTasks();
			const task = tasks.filter(task => task.definition.task === 'r.task.packageTest')[0];
			const isInstalled = await checkInstalled(task.definition.pkg);
			if (isInstalled) {
				vscode.tasks.executeTask(task);
			}
		}),

		vscode.commands.registerCommand('r.packageTestExplorer', async () => {
			vscode.commands.executeCommand('workbench.view.testing.focus');

			if (context.workspaceState.get('positron.r.testExplorerSetUp') === true) {
				vscode.commands.executeCommand('testing.runAll');
			} else {
				// if this is first time opening the test explorer, wait for tests to be discovered
				onDidDiscoverTestFiles(() => {
					vscode.commands.executeCommand('testing.runAll');
				});
			}
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

		vscode.commands.registerCommand('r.selectInterpreter', async () => {
			await quickPickRuntime(runtimeManager);
		}),

		vscode.commands.registerCommand('r.scriptPath', async () => {
			const session = RSessionManager.instance.getConsoleSession();
			if (!session) {
				throw new Error(`Cannot get Rscript path; no R session available`);
			}
			const scriptPath = (session.runtimeMetadata.extraRuntimeData as RMetadataExtra).scriptpath;
			if (!scriptPath) {
				throw new Error(`Cannot get Rscript path; no Rscript path available`);
			}
			return scriptPath;
		}),

		// Commands used to source the current file
		vscode.commands.registerCommand('r.sourceCurrentFile', async (resource?: vscode.Uri) => {
			sourceCurrentFile(false, resource);
		}),
		vscode.commands.registerCommand('r.sourceCurrentFileWithEcho', async (resource?: vscode.Uri) => {
			sourceCurrentFile(true, resource);
		}),

		// Command used to source the current file
		vscode.commands.registerCommand('r.rmarkdownRender', async () => {
			const filePath = await getEditorFilePathForCommand();
			if (filePath) {
				const tasks = await getRPackageTasks(filePath);
				const task = tasks.filter(task => task.definition.task === 'r.task.rmarkdownRender')[0];
				const isInstalled = await checkInstalled(task.definition.pkg);
				if (isInstalled) {
					try {
						vscode.tasks.executeTask(task);
					} catch (e) {
						// This is not a valid file path, which isn't an error; it just
						// means the active editor has something loaded into it that
						// isn't a file on disk.
					}
				}
			}
		}),

		// Command used to get the minimum version of R supported by the extension
		vscode.commands.registerCommand('r.getMinimumRVersion', (): string => MINIMUM_R_VERSION),

		// Command used to initialize a new folder with renv
		vscode.commands.registerCommand('r.renvInit', async () => {
			// ensure renv is installed before calling renv::init()
			// this prompts the user to install if it's not already
			// if the user declines, renv::init() will not be called
			const isInstalled = await checkInstalled('renv', MINIMUM_RENV_VERSION);
			if (isInstalled) {
				const session = await positron.runtime.getForegroundSession();
				if (session) {
					session.execute(`renv::init()`, generateDirectInjectionId(), positron.RuntimeCodeExecutionMode.Interactive, positron.RuntimeErrorBehavior.Continue);
				} else {
					console.debug('[r.renvInit] no session available');
				}
			} else {
				console.debug('[r.renvInit] renv is not installed');
			}
		}),

		// Command used to open up the R Language Pack output channel and log information
		// about the R interpreter settings
		vscode.commands.registerCommand('r.interpreters.settingsInfo', async () => {
			LOGGER.show();
			printInterpreterSettingsInfo();
		}),

		// Commands used in RStudio migration walkthrough
		vscode.commands.registerCommand('r.walkthrough.updateRStudioKeybindings', async () => {
			vscode.commands.executeCommand('workbench.action.openSettings', 'workbench.keybindings.rstudioKeybindings');
		}),
		vscode.commands.registerCommand('r.walkthrough.formatOnSave', async () => {
			vscode.commands.executeCommand('workbench.action.openSettings', '@lang:r editor.formatOnSave');
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
		positron.runtime.executeCode(
			'r',	// R code
			code,	// The code to execute.
			true,	// Focus the console after executing the code.
			true,	// Do not check the code for completeness before executing.
			// Specify the runtime execution mode as NonInteractive so that the
			// code is not combined with pending code before being executed.
			positron.RuntimeCodeExecutionMode.NonInteractive
		);
	}
}

export async function getEditorFilePathForCommand(resource?: vscode.Uri) {
	let filePath: string | undefined;

	if (resource) {
		// Use the provided resource URI (from editor action bar button)
		filePath = resource.fsPath;
	} else {
		// Fall back to active text editor (from command palette or other invocations)
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			// No editor; nothing to do
			return;
		}
		filePath = editor.document.uri.fsPath;
	}
	if (!filePath) {
		// File is unsaved; show a warning
		vscode.window.showWarningMessage('Cannot save untitled file.');
		return;
	}

	// Save the file before executing command to ensure that the contents are
	// up to date with editor buffer.
	if (resource) {
		// Save the specific document
		const document = await vscode.workspace.openTextDocument(resource);
		if (document.isDirty) {
			await document.save();
		}
	} else {
		// Save the active editor
		await vscode.commands.executeCommand('workbench.action.files.save');
	}

	// Check to see if the fsPath is an actual path to a file using
	// the VS Code file system API.
	const fsStat = await vscode.workspace.fs.stat(vscode.Uri.file(filePath));

	// Return the full path, with POSIX path separators. Any additional path
	// math, escaping, or quoting is the responsibility of the caller.
	if (fsStat) {
		return filePath.replace(/\\/g, '/');
	}
	return;
}

async function sourceCurrentFile(echo: boolean, resource?: vscode.Uri) {
	try {
		const filePath = await getEditorFilePathForCommand(resource);
		// In the future, we may want to shorten the path by making it
		// relative to the current working directory.
		if (filePath) {
			let command = `source(${JSON.stringify(filePath)})`;
			if (echo) {
				command = `source(${JSON.stringify(filePath)}, echo = TRUE)`;
			}
			positron.runtime.executeCode('r', command, false);
		}
	} catch (e) {
		// This is not a valid file path, which isn't an error; it just
		// means the active editor has something loaded into it that
		// isn't a file on disk.  In Positron, there is currently a bug
		// which causes the REPL to act like an active editor. See:
		//
		// https://github.com/posit-dev/positron/issues/780
	}

}

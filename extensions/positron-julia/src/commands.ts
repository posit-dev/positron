/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';

import { JuliaRuntimeManager } from './runtime-manager';
import { LOGGER } from './extension';

/**
 * Registers Julia-specific commands.
 */
export function registerCommands(
	context: vscode.ExtensionContext,
	_runtimeManager: JuliaRuntimeManager
): void {
	// Create new Julia file
	context.subscriptions.push(
		vscode.commands.registerCommand('julia.createNewFile', async () => {
			const document = await vscode.workspace.openTextDocument({
				language: 'julia',
				content: '',
			});
			await vscode.window.showTextDocument(document);
		})
	);

	// Select Julia interpreter
	context.subscriptions.push(
		vscode.commands.registerCommand('julia.selectInterpreter', async () => {
			// TODO: Implement interpreter selection UI
			LOGGER.info('Julia interpreter selection not yet implemented');
			vscode.window.showInformationMessage(
				'Julia interpreter selection will be available in a future release.'
			);
		})
	);

	// Test runtime completions (debug command)
	context.subscriptions.push(
		vscode.commands.registerCommand('julia.testCompletions', async () => {
			LOGGER.info('Testing runtime completions...');

			// Check active editor
			const editor = vscode.window.activeTextEditor;
			if (editor) {
				LOGGER.info(`Active editor: scheme=${editor.document.uri.scheme}, language=${editor.document.languageId}`);
			} else {
				LOGGER.info('No active editor');
			}

			// Check active sessions
			const sessions = await positron.runtime.getActiveSessions();
			LOGGER.info(`Active sessions: ${sessions.map(s => s.runtimeMetadata.languageId).join(', ')}`);

			// Try to execute completion code
			const testCode = `let
	import REPL.REPLCompletions
	completions, range, should_complete = REPLCompletions.completions("prin", 4)
	join([REPLCompletions.completion_text(c) for c in completions], "\\n")
end`;

			try {
				// Try with Transient mode instead of Silent - Silent might not return results
				const result = await positron.runtime.executeCode(
					'julia',
					testCode,
					false,
					true,
					positron.RuntimeCodeExecutionMode.Transient,
					positron.RuntimeErrorBehavior.Continue
				);
				LOGGER.info(`Completion test result: ${JSON.stringify(result)}`);
				vscode.window.showInformationMessage(`Completions: ${JSON.stringify(result)}`);
			} catch (err) {
				LOGGER.error(`Completion test failed: ${err}`);
				vscode.window.showErrorMessage(`Completion test failed: ${err}`);
			}
		})
	);

	// Source current file
	context.subscriptions.push(
		vscode.commands.registerCommand('julia.sourceCurrentFile', async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				vscode.window.showWarningMessage('No active editor');
				return;
			}

			const document = editor.document;
			if (document.languageId !== 'julia') {
				vscode.window.showWarningMessage('Active file is not a Julia file');
				return;
			}

			// Save the file first
			await document.save();

			// Get the file path
			const filePath = document.uri.fsPath;

			// Execute include() in the active Julia session
			// TODO: Get the active Julia session and execute the code
			LOGGER.info(`Sourcing Julia file: ${filePath}`);

			// For now, just show a message
			vscode.window.showInformationMessage(
				`Source current file will execute: include("${filePath}")`
			);
		})
	);
}

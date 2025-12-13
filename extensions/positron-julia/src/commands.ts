/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

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

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Zed Interpreter Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('should be able to activate extension', async () => {
		await activateZedExtension();
	});

	test('should display and execute `Move To New Window` for zed file', async () => {
		await activateZedExtension();
		await openZedFile();
		await checkAndExecuteCommand('workbench.action.moveEditorToNewWindow', 'Move into New Window');

		// verify that the active editor has changed or been closed in the current window
		const activeEditor = vscode.window.activeTextEditor;
		assert.ok(!activeEditor, 'Editor was not moved to a new window as expected');
		console.log('Editor successfully moved to a new window');

		// clean up by closing the opened .zed document
		await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
	});
});

async function activateZedExtension() {
	const extension = vscode.extensions.getExtension('positron.positron-zed');
	assert.ok(extension, 'Zed extension not found');
	await extension.activate();
	assert.ok(extension.isActive, 'Zed extension failed to activate');
	console.log('Zed extension activated successfully');
	return extension;
}

async function openZedFile() {
	// open a .zed file in the editor
	const document = await vscode.workspace.openTextDocument({ language: 'zed', content: 'empty document' });
	const editor = await vscode.window.showTextDocument(document);
	assert.ok(editor, 'Failed to open .zed document in the editor');
	console.log('Opened .zed document in editor');
	return editor;
}

async function checkAndExecuteCommand(commandId: string, description: string) {
	// retrieve available commands and check the presence of the command action
	const commands = await vscode.commands.getCommands();
	const commandExists = commands.includes(commandId);
	assert.ok(commandExists, `${description} is not available`);
	console.log(`Command "${description}" is available in commands`);

	// execute command to ensure it works
	await vscode.commands.executeCommand(commandId);
	console.log(`Executed "${commandId}" command`);
}

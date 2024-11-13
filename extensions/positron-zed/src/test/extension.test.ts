/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Zed Interpreter Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Zed Interpreter Activation Test', async () => {
		const extension = vscode.extensions.getExtension('vscode.positron-zed');
		assert.ok(extension, 'Extension not found');
		await extension.activate();
		assert.ok(extension.isActive, 'Extension is not active');
	});
});

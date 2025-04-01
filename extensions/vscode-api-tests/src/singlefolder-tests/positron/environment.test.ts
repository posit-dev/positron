/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import 'mocha';
import * as positron from 'positron';
import { assertNoRpcFromEntry } from '../../utils.js';
import * as vscode from 'vscode';
import assert from 'assert';

suite('positron API - environment', () => {

	setup(() => {
	});

	let extensionContext: vscode.ExtensionContext;

	suiteSetup(async () => {
		await vscode.extensions.getExtension('vscode.vscode-api-tests')?.activate();
		extensionContext = (global as any).testExtensionContext;
	});

	teardown(async function () {
		assertNoRpcFromEntry([positron, 'positron']);
	});

	test('environment variable collections returned', async () => {
		// Create an environment variable collection
		const collection = extensionContext.environmentVariableCollection;
		assert.ok(collection, 'Environment variable collection should be defined');

		// Set test values
		collection.append('test', 'value');
		collection.prepend('test2', 'value2');
		collection.replace('test3', 'value3');

		// Call the Positron API to get the environment variable contributions
		const contributions = await positron.environment.getEnvironmentContributions();

		// Check that the contributions contain the expected values
		assert.ok(contributions, 'Contributions should be defined');
		const contributedActions = contributions['vscode.vscode-api-tests'];
		assert.ok(contributedActions, 'Contributed actions should be defined');
		assert.strictEqual(contributedActions.length, 3, 'Should have 3 actions');

		// Check all the actions
		assert.strictEqual(contributedActions[0].action, vscode.EnvironmentVariableMutatorType.Append, 'First action should be append');
		assert.strictEqual(contributedActions[0].name, 'test', 'First action name should be "test"');
		assert.strictEqual(contributedActions[0].value, 'value', 'First action value should be "value"');
		assert.strictEqual(contributedActions[1].action, vscode.EnvironmentVariableMutatorType.Prepend, 'Second action should be prepend');
		assert.strictEqual(contributedActions[1].name, 'test2', 'Second action name should be "test2"');
		assert.strictEqual(contributedActions[1].value, 'value2', 'Second action value should be "value2"');
		assert.strictEqual(contributedActions[2].action, vscode.EnvironmentVariableMutatorType.Replace, 'Third action should be replace');
		assert.strictEqual(contributedActions[2].name, 'test3', 'Third action name should be "test3"');
		assert.strictEqual(contributedActions[2].value, 'value3', 'Third action value should be "value3"');
	});
});

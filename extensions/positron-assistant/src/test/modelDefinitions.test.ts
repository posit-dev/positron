/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { getAllModelDefinitions } from '../modelDefinitions.js';

suite('Model Definitions', () => {
	let mockWorkspaceConfig: sinon.SinonStub;

	setup(() => {
		// Mock vscode.workspace.getConfiguration
		mockWorkspaceConfig = sinon.stub();
		sinon.stub(vscode.workspace, 'getConfiguration').returns({
			get: mockWorkspaceConfig
		} as any);
	});

	teardown(() => {
		sinon.restore();
	});

	suite('getAllModelDefinitions', () => {
		test('prioritizes user-configured models over built-in', () => {
			const userModels = [
				{
					name: 'User Claude',
					identifier: 'user-claude'
				}
			];
			mockWorkspaceConfig.withArgs('configuredModels', {}).returns({
				'anthropic-api': userModels
			});

			const result = getAllModelDefinitions('anthropic-api');

			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].name, 'User Claude');
			assert.strictEqual(result[0].identifier, 'user-claude');
		});

		test('returns empty array for unknown provider', () => {
			mockWorkspaceConfig.withArgs('configuredModels', {}).returns({});

			const result = getAllModelDefinitions('unknown-provider');

			assert.deepStrictEqual(result, []);
		});

		test('show a warning if configured models include unsupported providers', async () => {
			const userModels = {
				'unsupported-provider': [
					{
						name: 'Some Model',
						identifier: 'some-model'
					}
				]
			};
			mockWorkspaceConfig.withArgs('configuredModels', {}).returns(userModels);

			const showWarningMessageStub = sinon.stub(vscode.window, 'showWarningMessage').resolves();

			// Call the function that verifies providers
			const { verifyProvidersInConfiguredModels } = await import('../modelDefinitions.js');
			await verifyProvidersInConfiguredModels();

			assert.strictEqual(showWarningMessageStub.calledOnce, true);
			const warningMessage = showWarningMessageStub.getCall(0).args[0];
			assert.ok(warningMessage.includes('unsupported-provider'));
		});

		test('does not show a warning if all configured providers are supported', async () => {
			const userModels = {
				'anthropic-api': [
					{
						name: 'Claude Sonnet 4.5',
						identifier: 'claude-sonnet-4-5'
					}
				]
			};
			mockWorkspaceConfig.withArgs('configuredModels', {}).returns(userModels);
			const showWarningMessageStub = sinon.stub(vscode.window, 'showWarningMessage').resolves();

			// Call the function that verifies providers
			const { verifyProvidersInConfiguredModels } = await import('../modelDefinitions.js');
			await verifyProvidersInConfiguredModels();

			assert.strictEqual(showWarningMessageStub.notCalled, true);
		});
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { getAllModelDefinitions } from '../modelDefinitions.js';
import { registerSupportedProviders } from '../providerConfiguration.js';
import * as modelsModule from '../models.js';

suite('Model Definitions', () => {
	let mockWorkspaceConfig: sinon.SinonStub;

	setup(() => {
		// Mock vscode.workspace.getConfiguration
		mockWorkspaceConfig = sinon.stub();
		sinon.stub(vscode.workspace, 'getConfiguration').callsFake(() => ({
			get: mockWorkspaceConfig
		}) as unknown as vscode.WorkspaceConfiguration);

		// Mock getLanguageModels to return test providers
		// Note: We only mock the provider metadata needed for registerSupportedProviders()
		const mockModels = [
			{
				source: {
					provider: {
						id: 'anthropic-api',
						displayName: 'Anthropic'
					}
				}
			},
			{
				source: {
					provider: {
						id: 'openai-api',
						displayName: 'OpenAI'
					}
				}
			}
		];
		// eslint-disable-next-line local/code-no-any-casts
		sinon.stub(modelsModule, 'getLanguageModels').returns(mockModels as any);

		// Register providers before running tests
		registerSupportedProviders();
	});

	teardown(() => {
		sinon.restore();
	});

	suite('getAllModelDefinitions', () => {
		test('prioritizes custom models over built-in (using display name)', () => {
			const userModels = [
				{
					name: 'User Claude',
					identifier: 'user-claude'
				}
			];
			mockWorkspaceConfig.withArgs('models.custom', {}).returns({
				'Anthropic': userModels
			});

			const result = getAllModelDefinitions('anthropic-api');

			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].name, 'User Claude');
			assert.strictEqual(result[0].identifier, 'user-claude');
		});

		test('prioritizes custom models over built-in (using provider ID)', () => {
			const userModels = [
				{
					name: 'User Claude',
					identifier: 'user-claude'
				}
			];
			mockWorkspaceConfig.withArgs('models.custom', {}).returns({
				'anthropic-api': userModels
			});

			const result = getAllModelDefinitions('anthropic-api');

			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].name, 'User Claude');
			assert.strictEqual(result[0].identifier, 'user-claude');
		});

		test('returns empty array for unknown provider', () => {
			mockWorkspaceConfig.withArgs('models.custom', {}).returns({});

			const result = getAllModelDefinitions('unknown-provider');

			assert.deepStrictEqual(result, []);
		});

		test('show a warning if custom models include unsupported providers', async () => {
			const userModels = {
				'unsupported-provider': [
					{
						name: 'Some Model',
						identifier: 'some-model'
					}
				]
			};
			mockWorkspaceConfig.withArgs('models.custom', {}).returns(userModels);
			mockWorkspaceConfig.withArgs('providers').returns({});
			mockWorkspaceConfig.withArgs('enabledProviders').returns([]);

			const showWarningMessageStub = sinon.stub(vscode.window, 'showWarningMessage').resolves();

			// Call the function that validates providers
			const { validateProvidersInCustomModels } = await import('../modelDefinitions.js');
			await validateProvidersInCustomModels();

			assert.strictEqual(showWarningMessageStub.calledOnce, true);
			const warningMessage = showWarningMessageStub.getCall(0).args[0];
			assert.ok(warningMessage.includes('unsupported-provider'));
		});

		test('does not show a warning if all custom model providers are supported (using display name)', async () => {
			const userModels = {
				'Anthropic': [
					{
						name: 'Claude Sonnet 4.5',
						identifier: 'claude-sonnet-4-5'
					}
				]
			};
			mockWorkspaceConfig.withArgs('models.custom', {}).returns(userModels);
			mockWorkspaceConfig.withArgs('providers').returns({ 'Anthropic': true });
			mockWorkspaceConfig.withArgs('enabledProviders').returns([]);

			const showWarningMessageStub = sinon.stub(vscode.window, 'showWarningMessage').resolves();

			// Call the function that validates providers
			const { validateProvidersInCustomModels } = await import('../modelDefinitions.js');
			await validateProvidersInCustomModels();

			assert.strictEqual(showWarningMessageStub.notCalled, true);
		});

		test('does not show a warning if all custom model providers are supported (using provider ID)', async () => {
			const userModels = {
				'anthropic-api': [
					{
						name: 'Claude Sonnet 4.5',
						identifier: 'claude-sonnet-4-5'
					}
				]
			};
			mockWorkspaceConfig.withArgs('models.custom', {}).returns(userModels);
			mockWorkspaceConfig.withArgs('providers').returns({ 'Anthropic': true });
			mockWorkspaceConfig.withArgs('enabledProviders').returns([]);

			const showWarningMessageStub = sinon.stub(vscode.window, 'showWarningMessage').resolves();

			// Call the function that validates providers
			const { validateProvidersInCustomModels } = await import('../modelDefinitions.js');
			await validateProvidersInCustomModels();

			assert.strictEqual(showWarningMessageStub.notCalled, true);
		});
	});
});

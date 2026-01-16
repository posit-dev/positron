/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as positron from 'positron';
import * as sinon from 'sinon';
import { getAllModelDefinitions } from '../modelDefinitions.js';
import { registerSupportedProviders } from '../providerConfiguration.js';
import * as providersModule from '../providers';

suite('Model Definitions', () => {
	let mockWorkspaceConfig: sinon.SinonStub;

	setup(() => {
		// Mock vscode.workspace.getConfiguration
		mockWorkspaceConfig = sinon.stub();
		sinon.stub(vscode.workspace, 'getConfiguration').callsFake(() => ({
			get: mockWorkspaceConfig
		}) as unknown as vscode.WorkspaceConfiguration);

		// Mock getModelProviders to return test providers
		// Note: We only mock the provider metadata needed for registerSupportedProviders()
		const mockModels = [
			{
				source: {
					provider: {
						id: 'anthropic-api',
						displayName: 'Anthropic',
						settingName: 'anthropic'
					}
				}
			},
			{
				source: {
					provider: {
						id: 'openai-api',
						displayName: 'OpenAI',
						settingName: 'openAI'
					}
				}
			}
		];
		// eslint-disable-next-line local/code-no-any-casts
		sinon.stub(providersModule, 'getModelProviders').returns(mockModels as any);

		// Register providers before running tests
		registerSupportedProviders();
	});

	teardown(() => {
		sinon.restore();
	});

	suite('getAllModelDefinitions', () => {
		test('prioritizes custom models over built-in', () => {
			const userModels = [
				{
					name: 'User Claude',
					identifier: 'user-claude'
				}
			];
			// Test with display name
			mockWorkspaceConfig.withArgs('models.custom', {}).returns({
				'Anthropic': userModels
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

			// Mock positron.ai.getEnabledProviders to return empty array (no providers enabled)
			const mockGetEnabledProviders = sinon.stub(positron.ai, 'getEnabledProviders').resolves([]);

			const showWarningMessageStub = sinon.stub(vscode.window, 'showWarningMessage').resolves();

			// Call the function that validates providers
			const { validateProvidersInCustomModels } = await import('../modelDefinitions.js');
			await validateProvidersInCustomModels();

			assert.strictEqual(showWarningMessageStub.calledOnce, true);
			const warningMessage = showWarningMessageStub.getCall(0).args[0];
			assert.ok(warningMessage.includes('unsupported-provider'));
			mockGetEnabledProviders.restore();
		});

		test('does not show a warning if all custom model providers are supported', async () => {
			const userModels = {
				'anthropic-api': [
					{
						name: 'Claude Sonnet 4.5',
						identifier: 'claude-sonnet-4-5'
					}
				]
			};
			mockWorkspaceConfig.withArgs('models.custom', {}).returns(userModels);

			// Mock positron.ai.getEnabledProviders to return anthropic-api
			const mockGetEnabledProviders = sinon.stub(positron.ai, 'getEnabledProviders').resolves(['anthropic-api']);

			const showWarningMessageStub = sinon.stub(vscode.window, 'showWarningMessage').resolves();

			// Call the function that validates providers
			const { validateProvidersInCustomModels } = await import('../modelDefinitions.js');
			await validateProvidersInCustomModels();

			assert.strictEqual(showWarningMessageStub.notCalled, true);
			mockGetEnabledProviders.restore();
		});
	});
});

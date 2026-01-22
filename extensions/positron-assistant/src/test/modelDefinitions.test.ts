/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
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
			// Test with individual models.overrides setting
			mockWorkspaceConfig.withArgs('models.overrides.anthropic').returns(userModels);

			const result = getAllModelDefinitions('anthropic-api');

			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].name, 'User Claude');
			assert.strictEqual(result[0].identifier, 'user-claude');
		});
	});
});

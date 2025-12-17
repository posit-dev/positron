/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as positron from 'positron';
import * as sinon from 'sinon';
import { PositModelProvider } from '../providers/posit/positProvider.js';
import { ModelConfig } from '../config.js';
import * as modelDefinitionsModule from '../modelDefinitions.js';
import * as helpersModule from '../modelResolutionHelpers.js';

suite('PositModelProvider', () => {
	let mockWorkspaceConfig: sinon.SinonStub;
	let mockConfig: ModelConfig;
	let positProvider: PositModelProvider;

	setup(() => {
		// Mock vscode.workspace.getConfiguration
		mockWorkspaceConfig = sinon.stub();
		sinon.stub(vscode.workspace, 'getConfiguration').callsFake((section?: string) => {
			if (section === 'positron.assistant.positai') {
				return {
					get: sinon.stub()
						.withArgs('authHost', '').returns('https://auth.posit.cloud')
						.withArgs('scope', '').returns('assistant')
						.withArgs('clientId', '').returns('test-client-id')
						.withArgs('baseUrl', '').returns('https://api.posit.cloud')
				} as any;
			}
			return {
				get: mockWorkspaceConfig
			} as any;
		});

		mockConfig = {
			id: 'posit-ai-test',
			provider: 'posit-ai',
			type: positron.PositronLanguageModelType.Chat,
			name: 'Claude Sonnet 4.5',
			model: 'claude-sonnet-4-5-20250929',
			apiKey: undefined,
			maxInputTokens: 200000,
			maxOutputTokens: 8192
		};

		// Mock the applyModelFilters import
		mockWorkspaceConfig.withArgs('unfilteredProviders', []).returns([]);
		mockWorkspaceConfig.withArgs('filterModels', []).returns([]);

		positProvider = new PositModelProvider(mockConfig);
	});

	teardown(() => {
		sinon.restore();
	});

	test('provider initializes with correct source configuration', () => {
		const source = PositModelProvider.source;

		assert.strictEqual(source.provider.id, 'posit-ai');
		assert.strictEqual(source.provider.displayName, 'Posit AI');
		assert.strictEqual(source.type, positron.PositronLanguageModelType.Chat);
		assert.ok(source.supportedOptions?.includes('oauth'));
	});

	test('provider uses correct default model', () => {
		const source = PositModelProvider.source;

		assert.strictEqual(source.defaults?.name, 'Claude Sonnet 4.5');
		assert.ok(source.defaults?.model?.includes('claude-sonnet-4-5'));
		assert.strictEqual(source.defaults?.toolCalls, true);
		assert.strictEqual(source.defaults?.oauth, true);
	});

	test('provider supports OAuth authentication', () => {
		const source = PositModelProvider.source;

		assert.strictEqual(source.defaults?.oauth, true);
	});

	test('provider has maxOutputTokens property', () => {
		assert.ok('maxOutputTokens' in positProvider);
		assert.strictEqual(typeof positProvider.maxOutputTokens, 'number');
	});

	suite('Model Resolution', () => {
		let mockModelDefinitions: sinon.SinonStub;
		let mockHelpers: { createModelInfo: sinon.SinonStub; markDefaultModel: sinon.SinonStub };

		setup(() => {
			mockModelDefinitions = sinon.stub(modelDefinitionsModule, 'getAllModelDefinitions');
			mockHelpers = {
				createModelInfo: sinon.stub(helpersModule, 'createModelInfo'),
				markDefaultModel: sinon.stub(helpersModule, 'markDefaultModel')
			};
		});

		teardown(() => {
			mockModelDefinitions.restore();
			mockHelpers.createModelInfo.restore();
			mockHelpers.markDefaultModel.restore();
		});

		suite('retrieveModelsFromConfig', () => {
			test('returns undefined when no configured models', () => {
				mockModelDefinitions.returns([]);
				const result = (positProvider as any).retrieveModelsFromConfig();
				assert.strictEqual(result, undefined);
			});

			test('returns configured models when built-in models exist', () => {
				const builtInModels = [
					{
						name: 'Claude Sonnet 4.5',
						identifier: 'claude-sonnet-4-5-20250929',
						maxInputTokens: 200000,
						maxOutputTokens: 8192
					}
				];
				mockModelDefinitions.returns(builtInModels);

				const mockModelInfo = {
					id: 'claude-sonnet-4-5-20250929',
					name: 'Claude Sonnet 4.5',
					family: 'posit-ai',
					version: '1.0',
					maxInputTokens: 200000,
					maxOutputTokens: 8192,
					capabilities: {},
					isDefault: true,
					isUserSelectable: true
				};
				mockHelpers.createModelInfo.returns(mockModelInfo);
				mockHelpers.markDefaultModel.returns([mockModelInfo]);

				const result = (positProvider as any).retrieveModelsFromConfig();

				assert.ok(result, 'Should return built-in models');
				assert.strictEqual(result.length, 1);
				assert.strictEqual(result[0].id, 'claude-sonnet-4-5-20250929');
			});
		});

		suite('resolveModels integration', () => {
			let cancellationToken: vscode.CancellationToken;

			setup(() => {
				const cancellationTokenSource = new vscode.CancellationTokenSource();
				cancellationToken = cancellationTokenSource.token;
			});

			test('prioritizes configured models', async () => {
				const configuredModels = [
					{
						name: 'Claude Sonnet 4.5',
						identifier: 'claude-sonnet-4-5-20250929'
					}
				];
				mockModelDefinitions.returns(configuredModels);

				const mockModelInfo = {
					id: 'claude-sonnet-4-5-20250929',
					name: 'Claude Sonnet 4.5',
					isDefault: true,
					isUserSelectable: true
				};
				mockHelpers.createModelInfo.returns(mockModelInfo);
				mockHelpers.markDefaultModel.returns([mockModelInfo]);

				const result = await positProvider.resolveModels(cancellationToken);

				assert.ok(result, 'Should return configured models');
				assert.strictEqual(result.length, 1);
				assert.strictEqual(result[0].id, 'claude-sonnet-4-5-20250929');
			});
		});
	});

	suite('OAuth Static Methods', () => {
		test('cancelCurrentSignIn is defined', () => {
			assert.strictEqual(typeof PositModelProvider.cancelCurrentSignIn, 'function');
		});

		test('signIn is defined', () => {
			assert.strictEqual(typeof PositModelProvider.signIn, 'function');
		});

		test('signOut is defined', () => {
			assert.strictEqual(typeof PositModelProvider.signOut, 'function');
		});

		test('refreshAccessToken is defined', () => {
			assert.strictEqual(typeof PositModelProvider.refreshAccessToken, 'function');
		});
	});
});

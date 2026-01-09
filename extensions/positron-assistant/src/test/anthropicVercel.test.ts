/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as positron from 'positron';
import * as sinon from 'sinon';
import { AnthropicAIModelProvider } from '../providers/anthropic/anthropicVercelProvider.js';
import { ModelConfig } from '../config.js';
import * as modelDefinitionsModule from '../modelDefinitions.js';
import * as helpersModule from '../modelResolutionHelpers.js';

suite('AnthropicAIModelProvider (Vercel SDK)', () => {
	let mockWorkspaceConfig: sinon.SinonStub;
	let mockConfig: ModelConfig;
	let anthropicProvider: AnthropicAIModelProvider;

	setup(() => {
		// Mock vscode.workspace.getConfiguration
		mockWorkspaceConfig = sinon.stub();
		sinon.stub(vscode.workspace, 'getConfiguration').returns({
			get: mockWorkspaceConfig
		} as any);

		mockConfig = {
			id: 'anthropic-vercel-test',
			provider: 'anthropic-api',
			type: positron.PositronLanguageModelType.Chat,
			name: 'Claude 3.5 Sonnet',
			model: 'claude-3-5-sonnet-latest',
			apiKey: 'test-api-key', // pragma: allowlist secret
			maxInputTokens: 200000,
			maxOutputTokens: 8192
		};

		// Mock the applyModelFilters import
		mockWorkspaceConfig.withArgs('unfilteredProviders', []).returns([]);
		mockWorkspaceConfig.withArgs('filterModels', []).returns([]);

		anthropicProvider = new AnthropicAIModelProvider(mockConfig);
	});

	teardown(() => {
		sinon.restore();
	});

	test('provider initializes with correct source configuration', () => {
		const source = AnthropicAIModelProvider.source;

		assert.strictEqual(source.provider.id, 'anthropic-api');
		assert.strictEqual(source.provider.displayName, 'Anthropic');
		assert.strictEqual(source.type, positron.PositronLanguageModelType.Chat);
		assert.ok(source.supportedOptions?.includes('apiKey'));
		assert.ok(source.supportedOptions?.includes('autoconfigure'));
	});

	test('provider uses correct default model', () => {
		const source = AnthropicAIModelProvider.source;

		assert.strictEqual(source.defaults?.name, 'Claude Sonnet 4');
		assert.ok(source.defaults?.model?.includes('claude-sonnet-4'));
		assert.strictEqual(source.defaults?.toolCalls, true);
	});

	test('provider supports environment variable autoconfiguration', () => {
		const source = AnthropicAIModelProvider.source;

		assert.ok(source.defaults?.autoconfigure);
		assert.strictEqual(source.defaults?.autoconfigure?.type, positron.ai.LanguageModelAutoconfigureType.EnvVariable);
		assert.strictEqual((source.defaults?.autoconfigure as any).key, 'ANTHROPIC_API_KEY');
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
				const result = (anthropicProvider as any).retrieveModelsFromConfig();
				assert.strictEqual(result, undefined);
			});

			test('returns configured models when built-in models exist', () => {
				const builtInModels = [
					{
						name: 'Claude 3.5 Sonnet',
						identifier: 'claude-3-5-sonnet-20241022',
						maxInputTokens: 200000,
						maxOutputTokens: 8192
					}
				];
				mockModelDefinitions.returns(builtInModels);

				const mockModelInfo = {
					id: 'claude-3-5-sonnet-20241022',
					name: 'Claude 3.5 Sonnet',
					family: 'anthropic-api',
					version: '1.0',
					maxInputTokens: 200000,
					maxOutputTokens: 8192,
					capabilities: {},
					isDefault: true,
					isUserSelectable: true
				};
				mockHelpers.createModelInfo.returns(mockModelInfo);
				mockHelpers.markDefaultModel.returns([mockModelInfo]);

				const result = (anthropicProvider as any).retrieveModelsFromConfig();

				assert.ok(result, 'Should return built-in models');
				assert.strictEqual(result.length, 1);
				assert.strictEqual(result[0].id, 'claude-3-5-sonnet-20241022');
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
						name: 'Claude 3.5 Sonnet',
						identifier: 'claude-3-5-sonnet-20241022'
					}
				];
				mockModelDefinitions.returns(configuredModels);

				const mockModelInfo = {
					id: 'claude-3-5-sonnet-20241022',
					name: 'Claude 3.5 Sonnet',
					isDefault: true,
					isUserSelectable: true
				};
				mockHelpers.createModelInfo.returns(mockModelInfo);
				mockHelpers.markDefaultModel.returns([mockModelInfo]);

				const result = await anthropicProvider.resolveModels(cancellationToken);

				assert.ok(result, 'Should return configured models');
				assert.strictEqual(result.length, 1);
				assert.strictEqual(result[0].id, 'claude-3-5-sonnet-20241022');
			});
		});
	});
});

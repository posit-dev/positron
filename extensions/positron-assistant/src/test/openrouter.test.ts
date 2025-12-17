/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as positron from 'positron';
import * as sinon from 'sinon';
import { OpenRouterModelProvider } from '../providers/openrouter/openrouterProvider.js';
import { ModelConfig } from '../config.js';
import * as modelDefinitionsModule from '../modelDefinitions.js';
import * as helpersModule from '../modelResolutionHelpers.js';

suite('OpenRouterModelProvider', () => {
	let mockWorkspaceConfig: sinon.SinonStub;
	let mockConfig: ModelConfig;
	let openrouterProvider: OpenRouterModelProvider;

	setup(() => {
		// Mock vscode.workspace.getConfiguration
		mockWorkspaceConfig = sinon.stub();
		sinon.stub(vscode.workspace, 'getConfiguration').returns({
			get: mockWorkspaceConfig
		} as any);

		mockConfig = {
			id: 'openrouter-test',
			provider: 'openrouter',
			type: positron.PositronLanguageModelType.Chat,
			name: 'Claude 3.5 Sonnet',
			model: 'anthropic/claude-3.5-sonnet',
			apiKey: 'test-api-key', // pragma: allowlist secret
			baseUrl: 'https://openrouter.ai/api/v1',
			maxInputTokens: 200000,
			maxOutputTokens: 8192
		};

		// Mock the applyModelFilters import
		mockWorkspaceConfig.withArgs('unfilteredProviders', []).returns([]);
		mockWorkspaceConfig.withArgs('filterModels', []).returns([]);

		openrouterProvider = new OpenRouterModelProvider(mockConfig);
	});

	teardown(() => {
		sinon.restore();
	});

	test('provider initializes with correct source configuration', () => {
		const source = OpenRouterModelProvider.source;

		assert.strictEqual(source.provider.id, 'openrouter');
		assert.strictEqual(source.provider.displayName, 'OpenRouter');
		assert.strictEqual(source.type, positron.PositronLanguageModelType.Chat);
		assert.ok(source.supportedOptions?.includes('apiKey'));
		assert.ok(source.supportedOptions?.includes('baseUrl'));
		assert.ok(source.supportedOptions?.includes('toolCalls'));
	});

	test('provider uses correct default model', () => {
		const source = OpenRouterModelProvider.source;

		assert.strictEqual(source.defaults?.name, 'Claude 3.5 Sonnet');
		assert.strictEqual(source.defaults?.model, 'anthropic/claude-3.5-sonnet');
		assert.strictEqual(source.defaults?.toolCalls, true);
	});

	test('provider uses correct default base URL', () => {
		const source = OpenRouterModelProvider.source;

		assert.strictEqual(source.defaults?.baseUrl, 'https://openrouter.ai/api/v1');
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
				const result = (openrouterProvider as any).retrieveModelsFromConfig();
				assert.strictEqual(result, undefined);
			});

			test('returns configured models when built-in models exist', () => {
				const builtInModels = [
					{
						name: 'Claude 3.5 Sonnet',
						identifier: 'anthropic/claude-3.5-sonnet',
						maxInputTokens: 200000,
						maxOutputTokens: 8192
					}
				];
				mockModelDefinitions.returns(builtInModels);

				const mockModelInfo = {
					id: 'anthropic/claude-3.5-sonnet',
					name: 'Claude 3.5 Sonnet',
					family: 'openrouter',
					version: '1.0',
					maxInputTokens: 200000,
					maxOutputTokens: 8192,
					capabilities: {},
					isDefault: true,
					isUserSelectable: true
				};
				mockHelpers.createModelInfo.returns(mockModelInfo);
				mockHelpers.markDefaultModel.returns([mockModelInfo]);

				const result = (openrouterProvider as any).retrieveModelsFromConfig();

				assert.ok(result, 'Should return built-in models');
				assert.strictEqual(result.length, 1);
				assert.strictEqual(result[0].id, 'anthropic/claude-3.5-sonnet');
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
						identifier: 'anthropic/claude-3.5-sonnet'
					}
				];
				mockModelDefinitions.returns(configuredModels);

				const mockModelInfo = {
					id: 'anthropic/claude-3.5-sonnet',
					name: 'Claude 3.5 Sonnet',
					isDefault: true,
					isUserSelectable: true
				};
				mockHelpers.createModelInfo.returns(mockModelInfo);
				mockHelpers.markDefaultModel.returns([mockModelInfo]);

				const result = await openrouterProvider.resolveModels(cancellationToken);

				assert.ok(result, 'Should return configured models');
				assert.strictEqual(result.length, 1);
				assert.strictEqual(result[0].id, 'anthropic/claude-3.5-sonnet');
			});
		});
	});
});

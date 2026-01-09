/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as positron from 'positron';
import * as sinon from 'sinon';
import { OpenAICompatibleModelProvider } from '../providers/openai/openaiCompatibleProvider.js';
import { ModelConfig } from '../config.js';
import * as modelDefinitionsModule from '../modelDefinitions.js';
import * as helpersModule from '../modelResolutionHelpers.js';

suite('OpenAICompatibleModelProvider', () => {
	let mockWorkspaceConfig: sinon.SinonStub;
	let mockConfig: ModelConfig;
	let openaiCompatibleProvider: OpenAICompatibleModelProvider;

	setup(() => {
		// Mock vscode.workspace.getConfiguration
		mockWorkspaceConfig = sinon.stub();
		sinon.stub(vscode.workspace, 'getConfiguration').returns({
			get: mockWorkspaceConfig
		} as any);

		mockConfig = {
			id: 'openai-compatible-test',
			provider: 'openai-compatible',
			type: positron.PositronLanguageModelType.Chat,
			name: 'Local LLM',
			model: 'local-model',
			apiKey: undefined,
			baseUrl: 'http://localhost:1234/v1',
			maxInputTokens: 8192,
			maxOutputTokens: 4096
		};

		// Mock the applyModelFilters import
		mockWorkspaceConfig.withArgs('unfilteredProviders', []).returns([]);
		mockWorkspaceConfig.withArgs('filterModels', []).returns([]);

		openaiCompatibleProvider = new OpenAICompatibleModelProvider(mockConfig);
	});

	teardown(() => {
		sinon.restore();
	});

	test('provider initializes with correct source configuration', () => {
		const source = OpenAICompatibleModelProvider.source;

		assert.strictEqual(source.provider.id, 'openai-compatible');
		assert.strictEqual(source.provider.displayName, 'Custom Provider');
		assert.strictEqual(source.type, positron.PositronLanguageModelType.Chat);
		assert.ok(source.supportedOptions?.includes('apiKey'));
		assert.ok(source.supportedOptions?.includes('baseUrl'));
		assert.ok(source.supportedOptions?.includes('toolCalls'));
	});

	test('provider uses correct default model', () => {
		const source = OpenAICompatibleModelProvider.source;

		assert.strictEqual(source.defaults?.name, 'Custom Provider');
		assert.strictEqual(source.defaults?.model, 'openai-compatible');
		assert.strictEqual(source.defaults?.toolCalls, true);
		assert.strictEqual(source.defaults?.completions, false);
	});

	test('provider uses correct default base URL', () => {
		const source = OpenAICompatibleModelProvider.source;

		assert.strictEqual(source.defaults?.baseUrl, 'https://localhost:1337/v1');
	});

	test('provider inherits from OpenAIModelProvider', () => {
		// OpenAICompatibleModelProvider should be a subclass of OpenAIModelProvider
		const OpenAIModelProvider = require('../providers/openai/openaiProvider.js').OpenAIModelProvider;
		assert.ok(openaiCompatibleProvider instanceof OpenAIModelProvider);
	});

	test('baseUrl getter strips trailing slashes', () => {
		const configWithTrailingSlash: ModelConfig = {
			...mockConfig,
			baseUrl: 'http://localhost:1234/v1///'
		};
		const provider = new OpenAICompatibleModelProvider(configWithTrailingSlash);
		assert.strictEqual(provider.baseUrl, 'http://localhost:1234/v1');
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
				const result = (openaiCompatibleProvider as any).retrieveModelsFromConfig();
				assert.strictEqual(result, undefined);
			});

			test('returns configured models when built-in models exist', () => {
				const builtInModels = [
					{
						name: 'Local LLM',
						identifier: 'local-model',
						maxInputTokens: 8192,
						maxOutputTokens: 4096
					}
				];
				mockModelDefinitions.returns(builtInModels);

				const mockModelInfo = {
					id: 'local-model',
					name: 'Local LLM',
					family: 'openai-compatible',
					version: '1.0',
					maxInputTokens: 8192,
					maxOutputTokens: 4096,
					capabilities: {},
					isDefault: true,
					isUserSelectable: true
				};
				mockHelpers.createModelInfo.returns(mockModelInfo);
				mockHelpers.markDefaultModel.returns([mockModelInfo]);

				const result = (openaiCompatibleProvider as any).retrieveModelsFromConfig();

				assert.ok(result, 'Should return built-in models');
				assert.strictEqual(result.length, 1);
				assert.strictEqual(result[0].id, 'local-model');
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
						name: 'Local LLM',
						identifier: 'local-model'
					}
				];
				mockModelDefinitions.returns(configuredModels);

				const mockModelInfo = {
					id: 'local-model',
					name: 'Local LLM',
					isDefault: true,
					isUserSelectable: true
				};
				mockHelpers.createModelInfo.returns(mockModelInfo);
				mockHelpers.markDefaultModel.returns([mockModelInfo]);

				const result = await openaiCompatibleProvider.resolveModels(cancellationToken);

				assert.ok(result, 'Should return configured models');
				assert.strictEqual(result.length, 1);
				assert.strictEqual(result[0].id, 'local-model');
			});
		});
	});
});

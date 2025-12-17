/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as positron from 'positron';
import * as sinon from 'sinon';
import { OllamaModelProvider } from '../providers/ollama/ollamaProvider.js';
import { ModelConfig } from '../config.js';
import * as modelDefinitionsModule from '../modelDefinitions.js';
import * as helpersModule from '../modelResolutionHelpers.js';

suite('OllamaModelProvider', () => {
	let mockWorkspaceConfig: sinon.SinonStub;
	let mockConfig: ModelConfig;
	let ollamaProvider: OllamaModelProvider;

	setup(() => {
		// Mock vscode.workspace.getConfiguration
		mockWorkspaceConfig = sinon.stub();
		sinon.stub(vscode.workspace, 'getConfiguration').returns({
			get: mockWorkspaceConfig
		} as any);

		mockConfig = {
			id: 'ollama-test',
			provider: 'ollama',
			type: positron.PositronLanguageModelType.Chat,
			name: 'Qwen 2.5 Coder',
			model: 'qwen2.5-coder:7b',
			apiKey: undefined,
			baseUrl: 'http://localhost:11434/api',
			numCtx: 4096,
			maxInputTokens: 32768,
			maxOutputTokens: 2048
		};

		// Mock the applyModelFilters import
		mockWorkspaceConfig.withArgs('unfilteredProviders', []).returns([]);
		mockWorkspaceConfig.withArgs('filterModels', []).returns([]);

		ollamaProvider = new OllamaModelProvider(mockConfig);
	});

	teardown(() => {
		sinon.restore();
	});

	test('provider initializes with correct source configuration', () => {
		const source = OllamaModelProvider.source;

		assert.strictEqual(source.provider.id, 'ollama');
		assert.strictEqual(source.provider.displayName, 'Ollama');
		assert.strictEqual(source.type, positron.PositronLanguageModelType.Chat);
		assert.ok(source.supportedOptions?.includes('baseUrl'));
		assert.ok(source.supportedOptions?.includes('toolCalls'));
		assert.ok(source.supportedOptions?.includes('numCtx'));
	});

	test('provider uses correct default model', () => {
		const source = OllamaModelProvider.source;

		assert.strictEqual(source.defaults?.name, 'Qwen 2.5');
		assert.strictEqual(source.defaults?.model, 'qwen2.5-coder:7b');
		assert.strictEqual(source.defaults?.toolCalls, false);
		assert.strictEqual(source.defaults?.numCtx, 2048);
	});

	test('provider uses correct default base URL', () => {
		const source = OllamaModelProvider.source;

		assert.strictEqual(source.defaults?.baseUrl, 'http://localhost:11434/api');
	});

	test('provider supports custom numCtx configuration', () => {
		assert.strictEqual(ollamaProvider['_config'].numCtx, 4096);
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
				const result = (ollamaProvider as any).retrieveModelsFromConfig();
				assert.strictEqual(result, undefined);
			});

			test('returns configured models when built-in models exist', () => {
				const builtInModels = [
					{
						name: 'Qwen 2.5 Coder',
						identifier: 'qwen2.5-coder:7b',
						maxInputTokens: 32768,
						maxOutputTokens: 2048
					}
				];
				mockModelDefinitions.returns(builtInModels);

				const mockModelInfo = {
					id: 'qwen2.5-coder:7b',
					name: 'Qwen 2.5 Coder',
					family: 'ollama',
					version: '1.0',
					maxInputTokens: 32768,
					maxOutputTokens: 2048,
					capabilities: {},
					isDefault: true,
					isUserSelectable: true
				};
				mockHelpers.createModelInfo.returns(mockModelInfo);
				mockHelpers.markDefaultModel.returns([mockModelInfo]);

				const result = (ollamaProvider as any).retrieveModelsFromConfig();

				assert.ok(result, 'Should return built-in models');
				assert.strictEqual(result.length, 1);
				assert.strictEqual(result[0].id, 'qwen2.5-coder:7b');
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
						name: 'Qwen 2.5 Coder',
						identifier: 'qwen2.5-coder:7b'
					}
				];
				mockModelDefinitions.returns(configuredModels);

				const mockModelInfo = {
					id: 'qwen2.5-coder:7b',
					name: 'Qwen 2.5 Coder',
					isDefault: true,
					isUserSelectable: true
				};
				mockHelpers.createModelInfo.returns(mockModelInfo);
				mockHelpers.markDefaultModel.returns([mockModelInfo]);

				const result = await ollamaProvider.resolveModels(cancellationToken);

				assert.ok(result, 'Should return configured models');
				assert.strictEqual(result.length, 1);
				assert.strictEqual(result[0].id, 'qwen2.5-coder:7b');
			});
		});
	});
});

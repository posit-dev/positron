/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as positron from 'positron';
import * as sinon from 'sinon';
import { OpenAILanguageModel } from '../models.js';
import { ModelConfig } from '../config.js';
import * as modelDefinitionsModule from '../modelDefinitions.js';
import * as helpersModule from '../modelResolutionHelpers.js';

suite('OpenAILanguageModel', () => {
	let mockWorkspaceConfig: sinon.SinonStub;
	let mockConfig: ModelConfig;
	let openAIModel: OpenAILanguageModel;

	setup(() => {
		// Mock vscode.workspace.getConfiguration
		mockWorkspaceConfig = sinon.stub();
		sinon.stub(vscode.workspace, 'getConfiguration').returns({
			get: mockWorkspaceConfig
		} as any);

		mockConfig = {
			id: 'openai-test',
			provider: 'openai-api',
			type: positron.PositronLanguageModelType.Chat,
			name: 'OpenAI Test',
			model: 'gpt-4',
			apiKey: 'test-api-key', // pragma: allowlist secret
			baseUrl: 'https://api.openai.com/v1',
			maxInputTokens: 8192,
			maxOutputTokens: 4096
		};

		// Mock the applyModelFilters import
		mockWorkspaceConfig.withArgs('unfilteredProviders', []).returns([]);
		mockWorkspaceConfig.withArgs('filterModels', []).returns([]);

		openAIModel = new OpenAILanguageModel(mockConfig);
	});

	teardown(() => {
		sinon.restore();
	});

	test('filterModels filters out models based on FILTERED_MODEL_PATTERNS', async () => {
		// Create mock models that include patterns to be filtered
		const allModels = [
			// Models that should be kept
			{ id: 'gpt-4', name: 'gpt-4', family: 'openai-api', version: '1.0', maxInputTokens: 8192, maxOutputTokens: 4096, capabilities: {}, isDefault: false, isUserSelectable: true },
			{ id: 'gpt-3.5-turbo', name: 'gpt-3.5-turbo', family: 'openai-api', version: '1.0', maxInputTokens: 4096, maxOutputTokens: 4096, capabilities: {}, isDefault: false, isUserSelectable: true },

			// Models that should be filtered out based on FILTERED_MODEL_PATTERNS
			{ id: 'gpt-5-search-api', name: 'gpt-5-search-api', family: 'openai-api', version: '1.0', maxInputTokens: 8192, maxOutputTokens: 4096, capabilities: {}, isDefault: false, isUserSelectable: true }, // contains 'search'
			{ id: 'gpt-4o-mini-audio-preview', name: 'gpt-4o-mini-audio-preview', family: 'openai-api', version: '1.0', maxInputTokens: 8192, maxOutputTokens: 4096, capabilities: {}, isDefault: false, isUserSelectable: true }, // contains 'audio'
			{ id: 'gpt-4o-realtime-preview', name: 'gpt-4o-realtime-preview', family: 'openai-api', version: '1.0', maxInputTokens: 8192, maxOutputTokens: 4096, capabilities: {}, isDefault: false, isUserSelectable: true }, // contains 'realtime'
			{ id: 'gpt-4o-transcribe', name: 'gpt-4o-transcribe', family: 'openai-api', version: '1.0', maxInputTokens: 8192, maxOutputTokens: 4096, capabilities: {}, isDefault: false, isUserSelectable: true }, // contains 'transcribe'

			// Case insensitive test - should be filtered out
			{ id: 'GPT-4-AUDIO-MODEL', name: 'GPT-4-AUDIO-MODEL', family: 'openai-api', version: '1.0', maxInputTokens: 8192, maxOutputTokens: 4096, capabilities: {}, isDefault: false, isUserSelectable: true }, // contains 'audio' (case insensitive)
			{ id: 'Text-Search-Model', name: 'Text-Search-Model', family: 'openai-api', version: '1.0', maxInputTokens: 8192, maxOutputTokens: 4096, capabilities: {}, isDefault: false, isUserSelectable: true }, // contains 'search' (case insensitive)
			{ id: 'GPT-4O-REALTIME-TEST', name: 'GPT-4O-REALTIME-TEST', family: 'openai-api', version: '1.0', maxInputTokens: 8192, maxOutputTokens: 4096, capabilities: {}, isDefault: false, isUserSelectable: true }, // contains 'realtime' (case insensitive)

			// Edge cases - should NOT be filtered out (word boundary protection)
			{ id: 'gpt-4-research-model', name: 'gpt-4-research-model', family: 'openai-api', version: '1.0', maxInputTokens: 8192, maxOutputTokens: 4096, capabilities: {}, isDefault: false, isUserSelectable: true }, // contains 'research' but not 'search' as whole word
			{ id: 'claude-multiaudio-beta', name: 'claude-multiaudio-beta', family: 'openai-api', version: '1.0', maxInputTokens: 8192, maxOutputTokens: 4096, capabilities: {}, isDefault: false, isUserSelectable: true }, // contains 'multiaudio' but not 'audio' as whole word
		] satisfies vscode.LanguageModelChatInformation[];

		const result = openAIModel.filterModels(allModels);

		// Should include 4 models: 2 original + 2 edge case models that shouldn't be filtered
		assert.strictEqual(result.length, 4, 'Should filter out audio, search, realtime, and transcribe models while preserving edge cases');

		const modelIds = result.map(m => m.id);

		// Should include these models (don't contain any filtered patterns)
		assert.ok(modelIds.includes('gpt-4'), 'Should include gpt-4');
		assert.ok(modelIds.includes('gpt-3.5-turbo'), 'Should include gpt-3.5-turbo');

		// Should include edge case models (word boundary protection)
		assert.ok(modelIds.includes('gpt-4-research-model'), 'Should include gpt-4-research-model (research != search as whole word)');
		assert.ok(modelIds.includes('claude-multiaudio-beta'), 'Should include claude-multiaudio-beta (multiaudio != audio as whole word)');

		// Should exclude models with 'search' pattern
		assert.ok(!modelIds.includes('gpt-5-search-api'), 'Should exclude gpt-5-search-api (contains search)');
		assert.ok(!modelIds.includes('Text-Search-Model'), 'Should exclude Text-Search-Model (contains search, case insensitive)');

		// Should exclude models with 'audio' pattern
		assert.ok(!modelIds.includes('gpt-4o-mini-audio-preview'), 'Should exclude gpt-4o-mini-audio-preview (contains audio)');
		assert.ok(!modelIds.includes('GPT-4-AUDIO-MODEL'), 'Should exclude GPT-4-AUDIO-MODEL (contains audio, case insensitive)');

		// Should exclude models with 'realtime' pattern
		assert.ok(!modelIds.includes('gpt-4o-realtime-preview'), 'Should exclude gpt-4o-realtime-preview (contains realtime)');
		assert.ok(!modelIds.includes('GPT-4O-REALTIME-TEST'), 'Should exclude GPT-4O-REALTIME-TEST (contains realtime, case insensitive)');

		// Should exclude models with 'transcribe' pattern
		assert.ok(!modelIds.includes('gpt-4o-transcribe'), 'Should exclude gpt-4o-transcribe (contains transcribe)');
	});

	suite('Model Resolution', () => {
		let mockModelDefinitions: sinon.SinonStub;
		let mockHelpers: { createModelInfo: sinon.SinonStub; isDefaultUserModel: sinon.SinonStub; markDefaultModel: sinon.SinonStub };

		setup(() => {
			// Mock getAllModelDefinitions
			mockModelDefinitions = sinon.stub(modelDefinitionsModule, 'getAllModelDefinitions');

			// Mock helper functions
			mockHelpers = {
				createModelInfo: sinon.stub(helpersModule, 'createModelInfo'),
				isDefaultUserModel: sinon.stub(helpersModule, 'isDefaultUserModel'),
				markDefaultModel: sinon.stub(helpersModule, 'markDefaultModel')
			};
		});

		teardown(() => {
			// Restore specific stubs for this suite
			mockModelDefinitions.restore();
			mockHelpers.createModelInfo.restore();
			mockHelpers.isDefaultUserModel.restore();
			mockHelpers.markDefaultModel.restore();
		});

		suite('retrieveModelsFromConfig', () => {
			test('returns undefined when no configured models', () => {
				mockModelDefinitions.returns([]);
				const result = (openAIModel as any).retrieveModelsFromConfig();
				assert.strictEqual(result, undefined);
			});

			test('returns configured models when built-in models exist', () => {
				const builtInModels = [
					{
						name: 'GPT-4',
						identifier: 'gpt-4',
						maxInputTokens: 8192,
						maxOutputTokens: 4096
					}
				];
				mockModelDefinitions.returns(builtInModels);

				const mockModelInfo = {
					id: 'gpt-4',
					name: 'GPT-4',
					family: 'openai-api',
					version: 'gpt-4',
					maxInputTokens: 8192,
					maxOutputTokens: 4096,
					capabilities: { vision: true, toolCalling: true, agentMode: true },
					isDefault: true,
					isUserSelectable: true
				};
				mockHelpers.createModelInfo.returns(mockModelInfo);
				mockHelpers.markDefaultModel.returns([mockModelInfo]);

				const result = (openAIModel as any).retrieveModelsFromConfig();

				assert.ok(result, 'Should return built-in models');
				assert.strictEqual(result.length, 1);
				assert.strictEqual(result[0].id, 'gpt-4');
			});

			test('marks one model as default', () => {
				const configuredModels = [
					{ name: 'GPT-4', identifier: 'gpt-4' },
					{ name: 'GPT-3.5 Turbo', identifier: 'gpt-3.5-turbo' }
				];
				mockModelDefinitions.returns(configuredModels);

				const mockModelInfoA = { id: 'gpt-4', name: 'GPT-4', isDefault: false, isUserSelectable: true };
				const mockModelInfoB = { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', isDefault: false, isUserSelectable: true };
				mockHelpers.createModelInfo.onFirstCall().returns(mockModelInfoA);
				mockHelpers.createModelInfo.onSecondCall().returns(mockModelInfoB);

				// Mock markDefaultModel to return the expected result with gpt-3.5-turbo as default
				const expectedResult = [
					{ id: 'gpt-4', name: 'GPT-4', isDefault: false, isUserSelectable: true },
					{ id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', isDefault: true, isUserSelectable: true }
				];
				mockHelpers.markDefaultModel.returns(expectedResult);

				const result = (openAIModel as any).retrieveModelsFromConfig();

				assert.ok(result, 'Should return models');
				assert.strictEqual(result.length, 2);
				// Only one should be marked as default
				const defaultModels = result.filter((m: any) => m.isDefault);
				assert.strictEqual(defaultModels.length, 1);
				assert.strictEqual(defaultModels[0].id, 'gpt-3.5-turbo');
			});

			test('falls back to default model match for default', () => {
				const configuredModels = [
					{ name: 'GPT-4', identifier: 'gpt-4' }
				];
				mockModelDefinitions.returns(configuredModels);

				const mockModelInfo = { id: 'gpt-4', name: 'GPT-4', isDefault: false, isUserSelectable: true };
				mockHelpers.createModelInfo.returns(mockModelInfo);

				// Mock markDefaultModel to return the expected result with the model as default
				const expectedResult = [
					{ id: 'gpt-4', name: 'GPT-4', isDefault: true, isUserSelectable: true }
				];
				mockHelpers.markDefaultModel.returns(expectedResult);

				const result = (openAIModel as any).retrieveModelsFromConfig();

				const defaultModel = result.find((m: any) => m.isDefault);
				assert.ok(defaultModel, 'Should have a default model');
				assert.strictEqual(defaultModel.id, 'gpt-4');

				// Verify markDefaultModel was called with the correct parameters
				sinon.assert.calledWith(mockHelpers.markDefaultModel, [mockModelInfo], 'openai-api', 'gpt-4');
			});
		});

		suite('resolveModels integration', () => {
			let cancellationToken: vscode.CancellationToken;
			let fetchStub: sinon.SinonStub;

			setup(() => {
				const cancellationTokenSource = new vscode.CancellationTokenSource();
				cancellationToken = cancellationTokenSource.token;
				fetchStub = sinon.stub(global, 'fetch');
			});

			teardown(() => {
				fetchStub.restore();
			});

			test('prioritizes configured models over API', async () => {
				const configuredModels = [
					{ name: 'User GPT', identifier: 'user-gpt' }
				];
				mockModelDefinitions.returns(configuredModels);

				const mockModelInfo = {
					id: 'user-gpt',
					name: 'User GPT',
					isDefault: true,
					isUserSelectable: true
				};
				mockHelpers.createModelInfo.returns(mockModelInfo);
				mockHelpers.markDefaultModel.returns([mockModelInfo]);

				const result = await openAIModel.resolveModels(cancellationToken);

				assert.ok(result, 'Should return configured models');
				assert.strictEqual(result.length, 1);
				assert.strictEqual(result[0].id, 'user-gpt');
				assert.strictEqual((openAIModel as any).modelListing, result);
			});

			test('falls back to API when no configured models', async () => {
				mockModelDefinitions.returns([]); // No configured models

				const apiResponse = {
					data: [
						{ id: 'gpt-api-model', object: 'model', created: 1640995200, owned_by: 'openai' }
					]
				};
				fetchStub.resolves({
					ok: true,
					json: () => Promise.resolve(apiResponse)
				});

				const mockModelInfo = {
					id: 'gpt-api-model',
					name: 'gpt-api-model',
					isDefault: true,
					isUserSelectable: true
				};
				mockHelpers.createModelInfo.returns(mockModelInfo);
				mockHelpers.markDefaultModel.returns([mockModelInfo]);

				const result = await openAIModel.resolveModels(cancellationToken);

				assert.ok(result, 'Should return API models');
				assert.strictEqual(result.length, 1);
				assert.strictEqual(result[0].id, 'gpt-api-model');
				assert.strictEqual((openAIModel as any).modelListing, result);
			});

			test('returns undefined when both configured and API fail', async () => {
				mockModelDefinitions.returns([]); // No configured models
				fetchStub.rejects(new Error('API Error'));

				const result = await openAIModel.resolveModels(cancellationToken);

				assert.strictEqual(result, undefined);
			});

			test('caches resolved models in modelListing', async () => {
				const configuredModels = [
					{ name: 'Cached GPT', identifier: 'cached-gpt' }
				];
				mockModelDefinitions.returns(configuredModels);

				const mockModelInfo = {
					id: 'cached-gpt',
					name: 'Cached GPT',
					isDefault: true,
					isUserSelectable: true
				};
				mockHelpers.createModelInfo.returns(mockModelInfo);
				mockHelpers.markDefaultModel.returns([mockModelInfo]);

				await openAIModel.resolveModels(cancellationToken);

				assert.strictEqual((openAIModel as any).modelListing.length, 1);
				assert.strictEqual((openAIModel as any).modelListing[0].id, 'cached-gpt');
			});
		});
	});
});

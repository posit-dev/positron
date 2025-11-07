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

suite('Models', () => {
	let mockWorkspaceConfig: sinon.SinonStub;
	let mockFetch: sinon.SinonStub;

	setup(() => {
		// Mock vscode.workspace.getConfiguration
		mockWorkspaceConfig = sinon.stub();
		sinon.stub(vscode.workspace, 'getConfiguration').returns({
			get: mockWorkspaceConfig
		} as any);

		// Mock global fetch
		mockFetch = sinon.stub(global, 'fetch' as any);
	});

	teardown(() => {
		sinon.restore();
	});

	suite('OpenAILanguageModel', () => {
		let mockConfig: ModelConfig;
		let openAIModel: OpenAILanguageModel;

		setup(() => {
			mockConfig = {
				id: 'openai-test',
				provider: 'openai-api',
				type: positron.PositronLanguageModelType.Chat,
				name: 'OpenAI Test',
				model: 'gpt-4',
				apiKey: 'test-api-key', // pragma: allowlist secret
				baseUrl: 'https://api.openai.com/v1'
			};

			// Mock the applyModelFilters import
			mockWorkspaceConfig.withArgs('unfilteredProviders', []).returns([]);
			mockWorkspaceConfig.withArgs('filterModels', []).returns([]);

			openAIModel = new OpenAILanguageModel(mockConfig);
		});

		test('resolveModels filters out models based on FILTERED_MODEL_PATTERNS', async () => {
			const mockApiResponse = {
				data: [
					// Models that should be kept
					{ id: 'gpt-4', object: 'model' },
					{ id: 'gpt-3.5-turbo', object: 'model' },

					// Models that should be filtered out based on FILTERED_MODEL_PATTERNS
					{ id: 'gpt-5-search-api', object: 'model' }, // contains 'search'
					{ id: 'gpt-4o-mini-audio-preview', object: 'model' }, // contains 'audio'
					{ id: 'gpt-4o-realtime-preview', object: 'model' }, // contains 'realtime'
					{ id: 'gpt-4o-transcribe', object: 'model' }, // contains 'transcribe'

					// Case insensitive test - should be filtered out
					{ id: 'GPT-4-AUDIO-MODEL', object: 'model' }, // contains 'audio' (case insensitive)
					{ id: 'Text-Search-Model', object: 'model' }, // contains 'search' (case insensitive)
					{ id: 'GPT-4O-REALTIME-TEST', object: 'model' }, // contains 'realtime' (case insensitive)

					// Edge cases - should NOT be filtered out (word boundary protection)
					{ id: 'gpt-4-research-model', object: 'model' }, // contains 'research' but not 'search' as whole word
					{ id: 'claude-multiaudio-beta', object: 'model' }, // contains 'multiaudio' but not 'audio' as whole word
				]
			};

			mockFetch.resolves({
				ok: true,
				json: async () => mockApiResponse
			});

			const cancellationToken = new vscode.CancellationTokenSource().token;
			const result = await openAIModel.resolveModels(cancellationToken);

			// Should include 4 models: 2 original + 2 edge case models that shouldn't be filtered
			assert.strictEqual(result?.length, 4, 'Should filter out audio, search, realtime, and transcribe models while preserving edge cases');

			const modelIds = result?.map(m => m.id) || [];

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
	});
});

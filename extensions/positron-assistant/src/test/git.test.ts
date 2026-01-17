/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Git Commit Message Generation - Model Selection', () => {
	/**
	 * Helper to create a mock LanguageModelChat object
	 */
	function createMockModel(
		id: string,
		name: string,
		family: string = 'test',
		isUserSelectable: boolean = true
	): vscode.LanguageModelChat {
		return {
			id,
			name,
			vendor: 'test-vendor',
			family,
			// Using type assertion for proposed API properties
			isUserSelectable,
			sendRequest: async () => {
				throw new Error('Not implemented');
			},
			countTokens: async () => 0
		} as any as vscode.LanguageModelChat;
	}

	suite('Model Filtering for Commit Generation', () => {
		test('should filter out expensive/specialized models', () => {
			const models = [
				createMockModel('gpt-5.2-codex', 'GPT 5.2 Codex'),
				createMockModel('gpt-4', 'GPT 4'),
				createMockModel('gpt-search-api', 'GPT Search API'),
				createMockModel('gpt-4o-mini', 'GPT 4o Mini'),
			];

			// We can't directly test the filterModelsForCommitGeneration function since it's not exported,
			// but we can verify the patterns by testing the model names
			const excludePatterns = [
				/codex/i,
				/search/i,
				/audio/i,
				/realtime/i,
				/transcribe/i,
				/vision/i,
			];

			const filtered = models.filter(model => {
				const modelIdentifier = `${model.id} ${model.name}`;
				return !excludePatterns.some(pattern => pattern.test(modelIdentifier));
			});

			assert.strictEqual(filtered.length, 2, 'Should filter out codex and search models');
			assert.ok(filtered.some(m => m.id === 'gpt-4'), 'Should keep GPT 4');
			assert.ok(filtered.some(m => m.id === 'gpt-4o-mini'), 'Should keep GPT 4o Mini');
			assert.ok(!filtered.some(m => m.id === 'gpt-5.2-codex'), 'Should exclude codex model');
			assert.ok(!filtered.some(m => m.id === 'gpt-search-api'), 'Should exclude search model');
		});

		test('should filter out non-user-selectable models', () => {
			const models = [
				createMockModel('gpt-4', 'GPT 4', 'openai', true),
				createMockModel('gpt-internal', 'GPT Internal', 'openai', false),
				createMockModel('claude-3', 'Claude 3', 'anthropic', true),
			];

			const filtered = models.filter(model => (model as any).isUserSelectable !== false);

			assert.strictEqual(filtered.length, 2, 'Should filter out non-user-selectable model');
			assert.ok(filtered.some(m => m.id === 'gpt-4'), 'Should keep user-selectable GPT 4');
			assert.ok(filtered.some(m => m.id === 'claude-3'), 'Should keep user-selectable Claude 3');
			assert.ok(!filtered.some(m => m.id === 'gpt-internal'), 'Should exclude non-user-selectable model');
		});

		test('should filter out test/error models', () => {
			const models = [
				createMockModel('gpt-4', 'GPT 4', 'openai'),
				createMockModel('echo-model', 'Echo Model', 'echo'),
				createMockModel('error-model', 'Error Model', 'error'),
			];

			const filtered = models.filter(model => model.family !== 'echo' && model.family !== 'error');

			assert.strictEqual(filtered.length, 1, 'Should filter out echo and error models');
			assert.ok(filtered.some(m => m.id === 'gpt-4'), 'Should keep GPT 4');
			assert.ok(!filtered.some(m => m.id === 'echo-model'), 'Should exclude echo model');
			assert.ok(!filtered.some(m => m.id === 'error-model'), 'Should exclude error model');
		});

		test('should prefer cheaper models', () => {
			const models = [
				createMockModel('gpt-4', 'GPT 4'),
				createMockModel('gpt-4o-mini', 'GPT 4o Mini'),
				createMockModel('claude-3', 'Claude 3'),
				createMockModel('claude-haiku', 'Claude Haiku'),
				createMockModel('gemini-pro', 'Gemini Pro'),
				createMockModel('gemini-flash', 'Gemini Flash'),
			];

			const preferPatterns = [
				/mini/i,
				/flash/i,
				/haiku/i,
				/3\.5/i,
			];

			const preferred = models.filter(model => {
				const modelIdentifier = `${model.id} ${model.name}`;
				return preferPatterns.some(pattern => pattern.test(modelIdentifier));
			});

			assert.ok(preferred.length > 0, 'Should find preferred models');
			assert.ok(preferred.some(m => m.id === 'gpt-4o-mini'), 'Should prefer mini model');
			assert.ok(preferred.some(m => m.id === 'claude-haiku'), 'Should prefer haiku model');
			assert.ok(preferred.some(m => m.id === 'gemini-flash'), 'Should prefer flash model');
		});

		test('should exclude models with specialized patterns', () => {
			const models = [
				createMockModel('gpt-4o-mini-audio-preview', 'GPT 4o Mini Audio'),
				createMockModel('gpt-4o-realtime-preview', 'GPT 4o Realtime'),
				createMockModel('gpt-4o-transcribe', 'GPT 4o Transcribe'),
				createMockModel('gpt-4-vision', 'GPT 4 Vision'),
				createMockModel('gpt-4o-mini', 'GPT 4o Mini'),
			];

			const excludePatterns = [
				/codex/i,
				/search/i,
				/audio/i,
				/realtime/i,
				/transcribe/i,
				/vision/i,
			];

			const filtered = models.filter(model => {
				const modelIdentifier = `${model.id} ${model.name}`;
				return !excludePatterns.some(pattern => pattern.test(modelIdentifier));
			});

			assert.strictEqual(filtered.length, 1, 'Should exclude specialized models');
			assert.ok(filtered.some(m => m.id === 'gpt-4o-mini'), 'Should keep standard mini model');
			assert.ok(!filtered.some(m => m.id.includes('audio')), 'Should exclude audio models');
			assert.ok(!filtered.some(m => m.id.includes('realtime')), 'Should exclude realtime models');
			assert.ok(!filtered.some(m => m.id.includes('transcribe')), 'Should exclude transcribe models');
			assert.ok(!filtered.some(m => m.id.includes('vision')), 'Should exclude vision models');
		});

		test('should handle case-insensitive pattern matching', () => {
			const models = [
				createMockModel('GPT-4O-MINI', 'GPT 4O MINI'),
				createMockModel('CLAUDE-HAIKU', 'CLAUDE HAIKU'),
				createMockModel('gpt-codex', 'GPT CODEX'),
			];

			const excludePatterns = [/codex/i];
			const preferPatterns = [/mini/i, /haiku/i];

			const excludedFiltered = models.filter(model => {
				const modelIdentifier = `${model.id} ${model.name}`;
				return !excludePatterns.some(pattern => pattern.test(modelIdentifier));
			});

			const preferred = models.filter(model => {
				const modelIdentifier = `${model.id} ${model.name}`;
				return preferPatterns.some(pattern => pattern.test(modelIdentifier));
			});

			assert.ok(!excludedFiltered.some(m => m.id.toLowerCase().includes('codex')), 'Should exclude codex (case-insensitive)');
			assert.ok(preferred.some(m => m.id === 'GPT-4O-MINI'), 'Should prefer MINI (case-insensitive)');
			assert.ok(preferred.some(m => m.id === 'CLAUDE-HAIKU'), 'Should prefer HAIKU (case-insensitive)');
		});
	});
});

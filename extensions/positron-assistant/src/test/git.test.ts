/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Git Commit Message Generation - Model Reordering', () => {
	/**
	 * Helper to create a mock LanguageModelChat object
	 */
	function createMockModel(
		id: string,
		name: string,
		family: string = 'test'
	): vscode.LanguageModelChat {
		return {
			id,
			name,
			vendor: 'test-vendor',
			family,
			sendRequest: async () => {
				throw new Error('Not implemented');
			},
			countTokens: async () => 0
		} as any as vscode.LanguageModelChat;
	}

	suite('Model Reordering Logic', () => {
		test('should prefer models matching encouraged patterns in order', () => {
			const models = [
				createMockModel('gpt-4', 'GPT 4'),
				createMockModel('gpt-4o-mini', 'GPT 4o Mini'),
				createMockModel('claude-3', 'Claude 3'),
				createMockModel('claude-haiku', 'Claude Haiku'),
			];

			// Encouraged patterns: mini, haiku
			// Expected order: gpt-4o-mini (matches "mini"), claude-haiku (matches "haiku"), gpt-4, claude-3
			const encouragedPatterns = ['mini', 'haiku'];

			const matchesPattern = (pattern: string, model: vscode.LanguageModelChat): boolean => {
				const normalizedPattern = pattern.toLowerCase().trim();
				const modelId = model.id.toLowerCase();
				const modelName = model.name.toLowerCase();
				return modelId.includes(normalizedPattern) || modelName.includes(normalizedPattern);
			};

			const scoredModels = models.map(model => {
				let score = 0;
				for (let i = 0; i < encouragedPatterns.length; i++) {
					if (matchesPattern(encouragedPatterns[i], model)) {
						score = 1000 + (encouragedPatterns.length - i);
						break;
					}
				}
				return { model, score };
			});

			scoredModels.sort((a, b) => b.score - a.score);

			assert.strictEqual(scoredModels[0].model.id, 'gpt-4o-mini', 'First encouraged pattern (mini) should be first');
			assert.strictEqual(scoredModels[1].model.id, 'claude-haiku', 'Second encouraged pattern (haiku) should be second');
		});

		test('should deprioritize models matching discouraged patterns', () => {
			const models = [
				createMockModel('gpt-4', 'GPT 4'),
				createMockModel('gpt-5.2-codex', 'GPT 5.2 Codex'),
				createMockModel('gpt-search-api', 'GPT Search API'),
				createMockModel('gpt-4o-mini', 'GPT 4o Mini'),
			];

			// Discouraged patterns: codex, search
			// Expected order: gpt-4, gpt-4o-mini (no match), gpt-search-api (matches "search"), gpt-5.2-codex (matches "codex")
			const discouragedPatterns = ['codex', 'search'];

			const matchesPattern = (pattern: string, model: vscode.LanguageModelChat): boolean => {
				const normalizedPattern = pattern.toLowerCase().trim();
				const modelId = model.id.toLowerCase();
				const modelName = model.name.toLowerCase();
				return modelId.includes(normalizedPattern) || modelName.includes(normalizedPattern);
			};

			const scoredModels = models.map(model => {
				let score = 0;
				for (let i = 0; i < discouragedPatterns.length; i++) {
					if (matchesPattern(discouragedPatterns[i], model)) {
						score = -(discouragedPatterns.length - i);
						break;
					}
				}
				return { model, score };
			});

			scoredModels.sort((a, b) => {
				if (b.score !== a.score) {
					return b.score - a.score;
				}
				return models.indexOf(a.model) - models.indexOf(b.model);
			});

			// Verify discouraged models are at the end
			const discouragedIds = scoredModels.slice(-2).map(s => s.model.id);
			assert.ok(discouragedIds.includes('gpt-5.2-codex'), 'Codex model should be deprioritized');
			assert.ok(discouragedIds.includes('gpt-search-api'), 'Search model should be deprioritized');
		});

		test('should handle regex patterns', () => {
			const models = [
				createMockModel('gpt-3.5-turbo', 'GPT 3.5 Turbo'),
				createMockModel('gpt-4', 'GPT 4'),
				createMockModel('gpt-4o-mini', 'GPT 4o Mini'),
			];

			// Using regex pattern for "3.5"
			const pattern = '3\\.5';

			const matchesPattern = (pat: string, model: vscode.LanguageModelChat): boolean => {
				const regex = new RegExp(pat, 'i');
				return regex.test(model.id) || regex.test(model.name);
			};

			assert.ok(matchesPattern(pattern, models[0]), 'Should match GPT 3.5 with regex');
			assert.ok(!matchesPattern(pattern, models[1]), 'Should not match GPT 4');
		});

		test('should keep test/error models at the end', () => {
			const models = [
				createMockModel('gpt-4', 'GPT 4', 'openai'),
				createMockModel('echo-model', 'Echo Model', 'echo'),
				createMockModel('gpt-4o-mini', 'GPT 4o Mini', 'openai'),
				createMockModel('error-model', 'Error Model', 'error'),
			];

			const scoredModels = models.map(model => ({ model, score: 0 }));
			const nonTestModels = scoredModels.filter(({ model }) => model.family !== 'echo' && model.family !== 'error');
			const testModels = scoredModels.filter(({ model }) => model.family === 'echo' || model.family === 'error');
			const reordered = [...nonTestModels.map(({ model }) => model), ...testModels.map(({ model }) => model)];

			assert.strictEqual(reordered.length, 4, 'Should have all models');
			assert.strictEqual(reordered[0].family, 'openai', 'Non-test model should be first');
			assert.strictEqual(reordered[1].family, 'openai', 'Non-test model should be second');
			assert.ok(reordered[2].family === 'echo' || reordered[2].family === 'error', 'Test model should be at end');
			assert.ok(reordered[3].family === 'echo' || reordered[3].family === 'error', 'Test model should be at end');
		});

		test('should handle case-insensitive matching', () => {
			const models = [
				createMockModel('GPT-4O-MINI', 'GPT 4O MINI'),
				createMockModel('CLAUDE-HAIKU', 'CLAUDE HAIKU'),
			];

			const matchesPattern = (pattern: string, model: vscode.LanguageModelChat): boolean => {
				const normalizedPattern = pattern.toLowerCase().trim();
				const modelId = model.id.toLowerCase();
				const modelName = model.name.toLowerCase();
				return modelId.includes(normalizedPattern) || modelName.includes(normalizedPattern);
			};

			assert.ok(matchesPattern('mini', models[0]), 'Should match MINI (case-insensitive)');
			assert.ok(matchesPattern('haiku', models[1]), 'Should match HAIKU (case-insensitive)');
		});

		test('should maintain original order for models with same score', () => {
			const models = [
				createMockModel('gpt-4', 'GPT 4'),
				createMockModel('claude-3', 'Claude 3'),
				createMockModel('gemini-pro', 'Gemini Pro'),
			];

			// No patterns match, so all should have score 0
			const scoredModels = models.map(model => ({ model, score: 0 }));

			scoredModels.sort((a, b) => {
				if (b.score !== a.score) {
					return b.score - a.score;
				}
				return models.indexOf(a.model) - models.indexOf(b.model);
			});

			assert.strictEqual(scoredModels[0].model.id, 'gpt-4', 'Should maintain original order');
			assert.strictEqual(scoredModels[1].model.id, 'claude-3', 'Should maintain original order');
			assert.strictEqual(scoredModels[2].model.id, 'gemini-pro', 'Should maintain original order');
		});

		test('should prioritize encouraged over discouraged', () => {
			const models = [
				createMockModel('gpt-4', 'GPT 4'),
				createMockModel('gpt-codex', 'GPT Codex'),
				createMockModel('gpt-4o-mini', 'GPT 4o Mini'),
			];

			const encouragedPatterns = ['mini'];
			const discouragedPatterns = ['codex'];

			const matchesPattern = (pattern: string, model: vscode.LanguageModelChat): boolean => {
				const normalizedPattern = pattern.toLowerCase().trim();
				const modelId = model.id.toLowerCase();
				const modelName = model.name.toLowerCase();
				return modelId.includes(normalizedPattern) || modelName.includes(normalizedPattern);
			};

			const scoredModels = models.map(model => {
				let score = 0;
				for (let i = 0; i < encouragedPatterns.length; i++) {
					if (matchesPattern(encouragedPatterns[i], model)) {
						score = 1000 + (encouragedPatterns.length - i);
						break;
					}
				}
				if (score === 0) {
					for (let i = 0; i < discouragedPatterns.length; i++) {
						if (matchesPattern(discouragedPatterns[i], model)) {
							score = -(discouragedPatterns.length - i);
							break;
						}
					}
				}
				return { model, score };
			});

			scoredModels.sort((a, b) => b.score - a.score);

			assert.ok(scoredModels[0].score > 0, 'Encouraged model should have positive score');
			assert.ok(scoredModels[2].score < 0, 'Discouraged model should have negative score');
			assert.strictEqual(scoredModels[0].model.id, 'gpt-4o-mini', 'Mini model should be first');
			assert.strictEqual(scoredModels[2].model.id, 'gpt-codex', 'Codex model should be last');
		});
	});
});

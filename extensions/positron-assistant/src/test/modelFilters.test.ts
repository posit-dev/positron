/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { applyModelFilters } from '../modelFilters.js';

suite('Model Filters', () => {
	let mockWorkspaceConfig: sinon.SinonStub;

	setup(() => {
		// Mock vscode.workspace.getConfiguration
		mockWorkspaceConfig = sinon.stub();
		sinon.stub(vscode.workspace, 'getConfiguration').returns({
			get: mockWorkspaceConfig
		} as any);
	});

	teardown(() => {
		sinon.restore();
	});

	suite('applyModelFilters', () => {
		// Helper function to create test models
		function createTestModel(id: string, name: string, family: string = 'test'): vscode.LanguageModelChatInformation {
			return {
				id,
				name,
				version: '1.0',
				family,
				maxInputTokens: 4096,
				maxOutputTokens: 4096,
				capabilities: {}
			};
		}

		test('returns all models when vendor is in unfiltered providers', () => {
			const models = [
				createTestModel('gpt-4o', 'GPT-4o'),
				createTestModel('gpt-5', 'GPT 5')
			];

			mockWorkspaceConfig.withArgs('unfilteredProviders', []).returns(['openai']);
			mockWorkspaceConfig.withArgs('filterModels', []).returns(['claude']);

			const result = applyModelFilters(models, 'openai');

			assert.strictEqual(result.length, models.length);
			assert.deepStrictEqual(result, models);
		});

		test('uses default unfiltered providers when config is empty', () => {
			const models = [createTestModel('test-model', 'Test Model')];

			mockWorkspaceConfig.withArgs('unfilteredProviders', []).returns([]);
			mockWorkspaceConfig.withArgs('filterModels', []).returns(['claude']);

			// Should return all models for test providers
			const testResult = applyModelFilters(models, 'test-lm-vendor');
			assert.strictEqual(testResult.length, models.length);

			const echoResult = applyModelFilters(models, 'echo');
			assert.strictEqual(echoResult.length, models.length);
		});

		test('returns all models when no filter patterns configured', () => {
			const models = [
				createTestModel('claude-sonnet-4.5', 'Claude Sonnet 4.5'),
				createTestModel('claude-opus-4', 'Claude 4 Opus')
			];

			mockWorkspaceConfig.withArgs('unfilteredProviders', []).returns([]);
			mockWorkspaceConfig.withArgs('filterModels', []).returns([]);

			const result = applyModelFilters(models, 'anthropic');

			assert.strictEqual(result.length, models.length);
			assert.deepStrictEqual(result, models);
		});

		test('filters models using patterns', () => {
			const testCases = [
				{
					description: 'Versioned model matching',
					pattern: 'v2',
					models: [
						createTestModel('model-v2.1', 'Model Version 2.1'),
						createTestModel('model-v3.0', 'Model Version 3.0')
					],
					expectedIds: ['model-v2.1'],
					vendor: 'provider'
				},
				{
					description: 'Provider-specific naming',
					pattern: 'claude',
					models: [
						createTestModel('claude-opus-4-20250514', 'Claude Opus 4', 'claude'),
						createTestModel('claude-sonnet-3.5', 'Claude 3.5 Sonnet', 'claude'),
						createTestModel('gpt-4o', 'GPT-4o', 'gpt')
					],
					expectedIds: ['claude-opus-4-20250514', 'claude-sonnet-3.5'],
					vendor: 'anthropic'
				},
				{
					description: 'Date-based model versions',
					pattern: '2025',
					models: [
						createTestModel('claude-opus-4-20250514', 'Claude Opus 4', 'claude'),
						createTestModel('claude-sonnet-3.5', 'Claude 3.5 Sonnet', 'claude')
					],
					expectedIds: ['claude-opus-4-20250514'],
					vendor: 'anthropic'
				},
				{
					description: 'Model parameter size matching',
					pattern: 'chat',
					models: [
						createTestModel('llama-2-7b-chat', 'Llama 2 7B Chat', 'llama'),
						createTestModel('llama-2-13b-chat', 'Llama 2 13B Chat', 'llama'),
						createTestModel('llama-3-8b-instruct', 'Llama 3 8B Instruct', 'llama')
					],
					expectedIds: ['llama-2-7b-chat', 'llama-2-13b-chat'],
					vendor: 'meta'
				},
				{
					description: 'Case insensitive matching',
					pattern: 'CLAUDE',
					models: [
						createTestModel('claude-opus-4-20250514', 'Claude Opus 4', 'claude'),
						createTestModel('gpt-4o', 'GPT-4o', 'gpt')
					],
					expectedIds: ['claude-opus-4-20250514'],
					vendor: 'anthropic'
				},
				{
					description: 'Pro model variants matching',
					pattern: 'pro',
					models: [
						createTestModel('gemini-pro', 'Gemini Pro', 'gemini'),
						createTestModel('gemini-pro-vision', 'Gemini Pro Vision', 'gemini'),
						createTestModel('claude-opus', 'Claude Opus', 'claude')
					],
					expectedIds: ['gemini-pro', 'gemini-pro-vision'],
					vendor: 'google'
				}
			];

			testCases.forEach(testCase => {
				mockWorkspaceConfig.withArgs('unfilteredProviders', []).returns([]);
				mockWorkspaceConfig.withArgs('filterModels', []).returns([testCase.pattern]);

				const result = applyModelFilters(testCase.models, testCase.vendor);
				const resultIds = result.map(m => m.id);

				assert.strictEqual(
					result.length,
					testCase.expectedIds.length,
					`${testCase.description}: Expected ${testCase.expectedIds.length} models, got ${result.length}. Expected: ${testCase.expectedIds}, Got: ${resultIds}`
				);

				testCase.expectedIds.forEach(expectedId => {
					assert.ok(
						resultIds.includes(expectedId),
						`${testCase.description}: Expected model "${expectedId}" to be included in results`
					);
				});
			});
		});

		test('filters models using glob patterns', () => {
			const testCases = [
				{
					description: 'Explicit wildcard pattern',
					pattern: '*claude*',
					models: [
						createTestModel('claude-opus-4-20250514', 'Claude Opus 4', 'claude'),
						createTestModel('gpt-4o', 'GPT-4o', 'gpt')
					],
					expectedIds: ['claude-opus-4-20250514'],
					vendor: 'anthropic'
				},
				{
					description: 'Prefix wildcard pattern',
					pattern: 'gpt*',
					models: [
						createTestModel('gpt-4o', 'GPT-4o', 'gpt'),
						createTestModel('gpt-4o-mini', 'GPT-4o Mini', 'gpt'),
						createTestModel('claude-opus', 'Claude Opus', 'claude')
					],
					expectedIds: ['gpt-4o', 'gpt-4o-mini'],
					vendor: 'openai'
				},
				{
					description: 'Suffix wildcard pattern',
					pattern: '*chat',
					models: [
						createTestModel('llama-2-7b-chat', 'Llama 2 7B Chat', 'llama'),
						createTestModel('llama-3-8b-instruct', 'Llama 3 8B Instruct', 'llama')
					],
					expectedIds: ['llama-2-7b-chat'],
					vendor: 'meta'
				},
				{
					description: 'Multiple wildcards',
					pattern: '*gpt*4*',
					models: [
						createTestModel('gpt-4o', 'GPT-4o', 'gpt'),
						createTestModel('gpt-4o-mini', 'GPT-4o Mini', 'gpt'),
						createTestModel('gpt-3.5-turbo', 'GPT-3.5 Turbo', 'gpt')
					],
					expectedIds: ['gpt-4o', 'gpt-4o-mini'],
					vendor: 'openai'
				},
				{
					description: 'Hierarchical wildcard pattern',
					pattern: '**/gpt*',
					models: [
						createTestModel('openai/gpt-5', 'OpenAI GPT-5', 'gpt'),
						createTestModel('gpt-4o', 'GPT-4o', 'gpt')
					],
					expectedIds: ['openai/gpt-5'],
					vendor: 'openai-compatible'
				}
			];

			testCases.forEach(testCase => {
				mockWorkspaceConfig.withArgs('unfilteredProviders', []).returns([]);
				mockWorkspaceConfig.withArgs('filterModels', []).returns([testCase.pattern]);

				const result = applyModelFilters(testCase.models, testCase.vendor);
				const resultIds = result.map(m => m.id);

				assert.strictEqual(
					result.length,
					testCase.expectedIds.length,
					`${testCase.description}: Expected ${testCase.expectedIds.length} models, got ${result.length}. Expected: ${testCase.expectedIds}, Got: ${resultIds}`
				);

				testCase.expectedIds.forEach(expectedId => {
					assert.ok(
						resultIds.includes(expectedId),
						`${testCase.description}: Expected model "${expectedId}" to be included in results`
					);
				});
			});
		});

		test('handles edge cases and empty inputs', () => {
			const testCases = [
				{
					description: 'Empty pattern matches all',
					pattern: '',
					models: [
						createTestModel('gpt-4o', 'GPT-4o'),
						createTestModel('claude-opus', 'Claude Opus')
					],
					expectedCount: 2,
					vendor: 'custom provider'
				},
				{
					description: 'Whitespace-only pattern matches all',
					pattern: '   ',
					models: [createTestModel('test-model', 'Test Model')],
					expectedCount: 1,
					vendor: 'test provider'
				},
				{
					description: 'Pattern with leading/trailing whitespace',
					pattern: '  claude  ',
					models: [
						createTestModel('claude-opus-4-20250514', 'Claude Opus 4', 'claude'),
						createTestModel('gpt-4o', 'GPT-4o', 'gpt')
					],
					expectedIds: ['claude-opus-4-20250514'],
					vendor: 'anthropic'
				},
				{
					description: 'Non-matching pattern',
					pattern: 'nonexistent',
					models: [createTestModel('gpt-4o', 'GPT-4o')],
					expectedCount: 0,
					vendor: 'any'
				}
			];

			testCases.forEach(testCase => {
				mockWorkspaceConfig.withArgs('unfilteredProviders', []).returns([]);
				mockWorkspaceConfig.withArgs('filterModels', []).returns([testCase.pattern]);

				const result = applyModelFilters(testCase.models, testCase.vendor);

				if ('expectedCount' in testCase) {
					assert.strictEqual(
						result.length,
						testCase.expectedCount,
						`${testCase.description}: Expected ${testCase.expectedCount} models, got ${result.length}`
					);
				} else if ('expectedIds' in testCase) {
					assert.strictEqual(
						result.length,
						testCase.expectedIds.length,
						`${testCase.description}: Expected ${testCase.expectedIds.length} models, got ${result.length}`
					);

					const resultIds = result.map(m => m.id);
					testCase.expectedIds.forEach(expectedId => {
						assert.ok(
							resultIds.includes(expectedId),
							`${testCase.description}: Expected model "${expectedId}" to be included in results`
						);
					});
				}
			});
		});

		test('filters models based on multiple patterns', () => {
			const models = [
				createTestModel('gpt-4o', 'GPT-4o', 'gpt'),
				createTestModel('gpt-4o-mini', 'GPT-4o Mini', 'gpt'),
				createTestModel('claude-opus-4-20250514', 'Claude Opus 4', 'claude'),
				createTestModel('claude-sonnet-3.5', 'Claude 3.5 Sonnet', 'claude'),
				createTestModel('llama-2-7b-chat', 'Llama 2 7B Chat', 'llama')
			];

			mockWorkspaceConfig.withArgs('unfilteredProviders', []).returns([]);
			mockWorkspaceConfig.withArgs('filterModels', []).returns(['gpt', 'claude']);

			const result = applyModelFilters(models, 'mixed-vendor');

			assert.strictEqual(result.length, 4); // All GPT and Claude models
			const resultIds = result.map(m => m.id);

			// GPT models
			assert.ok(resultIds.includes('gpt-4o'));
			assert.ok(resultIds.includes('gpt-4o-mini'));

			// Claude models
			assert.ok(resultIds.includes('claude-opus-4-20250514'));
			assert.ok(resultIds.includes('claude-sonnet-3.5'));

			// Should not include Llama
			assert.ok(!resultIds.includes('llama-2-7b-chat'));
		});

		test('filters models using glob patterns with multiple patterns', () => {
			const models = [
				createTestModel('gpt-4o', 'GPT-4o', 'gpt'),
				createTestModel('openai/gpt-5', 'OpenAI GPT-5', 'gpt'),
				createTestModel('llama-2-7b-chat', 'Llama 2 7B Chat', 'llama'),
				createTestModel('llama-2-13b-chat', 'Llama 2 13B Chat', 'llama'),
				createTestModel('claude-opus', 'Claude Opus', 'claude')
			];

			mockWorkspaceConfig.withArgs('unfilteredProviders', []).returns([]);
			mockWorkspaceConfig.withArgs('filterModels', []).returns(['gpt', '*chat*']);

			const result = applyModelFilters(models, 'mixed-vendor');

			assert.strictEqual(result.length, 4); // All GPT models + chat models
			const resultIds = result.map(m => m.id);

			// GPT models
			assert.ok(resultIds.includes('gpt-4o'));
			assert.ok(resultIds.includes('openai/gpt-5'));

			// Chat models
			assert.ok(resultIds.includes('llama-2-7b-chat'));
			assert.ok(resultIds.includes('llama-2-13b-chat'));

			// Should not include Claude (doesn't match either pattern)
			assert.ok(!resultIds.includes('claude-opus'));
		});

		test('returns empty array when no models match filters', () => {
			const models = [createTestModel('gpt-4o', 'GPT-4o')];

			mockWorkspaceConfig.withArgs('unfilteredProviders', []).returns([]);
			mockWorkspaceConfig.withArgs('filterModels', []).returns(['nonexistent']);

			const result = applyModelFilters(models, 'some-vendor');

			assert.strictEqual(result.length, 0);
		});

		test('handles empty model list', () => {
			mockWorkspaceConfig.withArgs('unfilteredProviders', []).returns([]);
			mockWorkspaceConfig.withArgs('filterModels', []).returns(['claude']);

			const result = applyModelFilters([], 'anthropic');

			assert.strictEqual(result.length, 0);
		});

		test('matches models by name when id does not match', () => {
			const models = [createTestModel('model-id-without-filter-string', 'Claude Opus 4')];

			mockWorkspaceConfig.withArgs('unfilteredProviders', []).returns([]);
			mockWorkspaceConfig.withArgs('filterModels', []).returns(['Opus']);

			const result = applyModelFilters(models, 'anthropic');

			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].id, 'model-id-without-filter-string');
		});

		test('matches models across both id and name fields', () => {
			const models = [
				createTestModel('gemini-pro', 'Gemini Pro', 'gemini'),
				createTestModel('gemini-pro-vision', 'Gemini Pro Vision', 'gemini'),
				createTestModel('claude-opus', 'Claude Opus', 'claude')
			];

			mockWorkspaceConfig.withArgs('unfilteredProviders', []).returns([]);
			mockWorkspaceConfig.withArgs('filterModels', []).returns(['Pro']); // Should match "Gemini Pro" and "Gemini Pro Vision" in name

			const result = applyModelFilters(models, 'google');

			assert.strictEqual(result.length, 2);
			const resultIds = result.map(m => m.id);
			assert.ok(resultIds.includes('gemini-pro'));
			assert.ok(resultIds.includes('gemini-pro-vision'));
		});

		test('handles special characters in model names and patterns', () => {
			const models = [createTestModel('model-v2.1', 'Model Version 2.1')];

			mockWorkspaceConfig.withArgs('unfilteredProviders', []).returns([]);
			mockWorkspaceConfig.withArgs('filterModels', []).returns(['v2.1']); // Pattern with dot

			const result = applyModelFilters(models, 'provider');

			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].id, 'model-v2.1');
		});
	});
});

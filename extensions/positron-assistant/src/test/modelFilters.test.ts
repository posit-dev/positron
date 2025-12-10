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
		const mockConfig: Pick<vscode.WorkspaceConfiguration, 'get'> = {
			get: mockWorkspaceConfig
		};
		sinon.stub(vscode.workspace, 'getConfiguration').returns(mockConfig as vscode.WorkspaceConfiguration);
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

		// Helper to check if a model is user selectable
		function isUserSelectable(model: vscode.LanguageModelChatInformation): boolean {
			return model.isUserSelectable !== false;
		}

		test('returns all models when vendor is in unfiltered providers', () => {
			const models = [
				createTestModel('gpt-4o', 'GPT-4o'),
				createTestModel('gpt-5', 'GPT 5')
			];

			mockWorkspaceConfig.withArgs('unfilteredProviders', []).returns(['openai']);
			mockWorkspaceConfig.withArgs('models.required', []).returns([]);
			mockWorkspaceConfig.withArgs('models.visible', []).returns(['claude']);

			const result = applyModelFilters(models, 'openai', 'OpenAI');

			assert.strictEqual(result.length, models.length);
			assert.deepStrictEqual(result, models);
		});

		test('uses default unfiltered providers when config is empty', () => {
			const models = [createTestModel('test-model', 'Test Model')];

			mockWorkspaceConfig.withArgs('unfilteredProviders', []).returns([]);
			mockWorkspaceConfig.withArgs('models.required', []).returns([]);
			mockWorkspaceConfig.withArgs('models.visible', []).returns(['claude']);

			// Should return all models for test providers
			const testResult = applyModelFilters(models, 'test-lm-vendor', 'Test LM Vendor');
			assert.strictEqual(testResult.length, models.length);

			const echoResult = applyModelFilters(models, 'echo', 'Echo');
			assert.strictEqual(echoResult.length, models.length);
		});

		test('returns all models when no filter patterns configured', () => {
			const models = [
				createTestModel('claude-sonnet-4.5', 'Claude Sonnet 4.5'),
				createTestModel('claude-opus-4', 'Claude 4 Opus')
			];

			mockWorkspaceConfig.withArgs('unfilteredProviders', []).returns([]);
			mockWorkspaceConfig.withArgs('models.required', []).returns([]);
			mockWorkspaceConfig.withArgs('models.visible', []).returns([]);

			const result = applyModelFilters(models, 'anthropic', 'Anthropic');

			assert.strictEqual(result.length, models.length);
			assert.deepStrictEqual(result, models);
		});

		test('filters models using patterns with models.visible', () => {
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
				}
			];

			testCases.forEach(testCase => {
				mockWorkspaceConfig.withArgs('unfilteredProviders', []).returns([]);
				mockWorkspaceConfig.withArgs('models.required', []).returns([]);
				mockWorkspaceConfig.withArgs('models.visible', []).returns([testCase.pattern]);

				const result = applyModelFilters(testCase.models, testCase.vendor, testCase.vendor);

				// All models should be returned
				assert.strictEqual(
					result.length,
					testCase.models.length,
					`${testCase.description}: Expected all models to be returned`
				);

				// Check that only expected models are selectable
				const selectableIds = result.filter(m => isUserSelectable(m)).map(m => m.id);
				assert.strictEqual(
					selectableIds.length,
					testCase.expectedIds.length,
					`${testCase.description}: Expected ${testCase.expectedIds.length} selectable models`
				);

				testCase.expectedIds.forEach(expectedId => {
					const model = result.find(m => m.id === expectedId);
					assert.ok(model, `${testCase.description}: Expected model "${expectedId}" to exist`);
					assert.ok(
						isUserSelectable(model!),
						`${testCase.description}: Expected model "${expectedId}" to be user-selectable`
					);
				});
			});
		});

		test('filters models using models.required (strict filtering)', () => {
			const models = [
				createTestModel('gpt-4o', 'GPT-4o', 'gpt'),
				createTestModel('gpt-4o-mini', 'GPT-4o Mini', 'gpt'),
				createTestModel('claude-opus-4', 'Claude Opus 4', 'claude'),
				createTestModel('claude-sonnet-3.5', 'Claude 3.5 Sonnet', 'claude'),
				createTestModel('llama-2-7b-chat', 'Llama 2 7B Chat', 'llama')
			];

			mockWorkspaceConfig.withArgs('unfilteredProviders', []).returns([]);
			mockWorkspaceConfig.withArgs('models.required', []).returns(['gpt']);
			mockWorkspaceConfig.withArgs('models.visible', []).returns([]);

			const result = applyModelFilters(models, 'mixed-vendor', 'Mixed Vendor');

			// Only GPT models should be returned (strict filtering removes others)
			assert.strictEqual(result.length, 2);
			assert.ok(result.find(m => m.id === 'gpt-4o'));
			assert.ok(result.find(m => m.id === 'gpt-4o-mini'));
			assert.ok(!result.find(m => m.id === 'claude-opus-4'));
			assert.ok(!result.find(m => m.id === 'llama-2-7b-chat'));

			// All returned models should be selectable (no soft filter)
			const selectableIds = result.filter(m => isUserSelectable(m)).map(m => m.id);
			assert.strictEqual(selectableIds.length, 2);
		});

		test('applies both models.required and models.visible together', () => {
			const models = [
				createTestModel('gpt-4o', 'GPT-4o', 'gpt'),
				createTestModel('gpt-4o-mini', 'GPT-4o Mini', 'gpt'),
				createTestModel('claude-opus-4', 'Claude Opus 4', 'claude'),
				createTestModel('claude-sonnet-3.5', 'Claude 3.5 Sonnet', 'claude'),
				createTestModel('llama-2-7b-chat', 'Llama 2 7B Chat', 'llama')
			];

			// models.required includes all but llama
			// models.visible allows only models with "4" in the name
			mockWorkspaceConfig.withArgs('unfilteredProviders', []).returns([]);
			mockWorkspaceConfig.withArgs('models.required', []).returns(['gpt', 'claude']);
			mockWorkspaceConfig.withArgs('models.visible', []).returns(['4']);

			const result = applyModelFilters(models, 'mixed-vendor', 'Mixed Vendor');

			// Only gpt and claude models returned (models.required)
			assert.strictEqual(result.length, 4);
			assert.ok(!result.find(m => m.id === 'llama-2-7b-chat'));

			// Only models with "4" should be selectable (models.visible)
			const selectableIds = result.filter(m => isUserSelectable(m)).map(m => m.id);
			assert.strictEqual(selectableIds.length, 2);
			assert.ok(selectableIds.includes('gpt-4o'));
			assert.ok(selectableIds.includes('claude-opus-4'));

			// Models not matching visible pattern should not be selectable
			const nonSelectable = result.filter(m => !isUserSelectable(m)).map(m => m.id);
			assert.strictEqual(nonSelectable.length, 2);
			assert.ok(nonSelectable.includes('gpt-4o-mini'));
			assert.ok(nonSelectable.includes('claude-sonnet-3.5'));
		});

		test('models.required removes all non-matching models', () => {
			const models = [
				createTestModel('gpt-4o', 'GPT-4o'),
				createTestModel('claude-opus', 'Claude Opus'),
				createTestModel('llama-2', 'Llama 2')
			];

			mockWorkspaceConfig.withArgs('unfilteredProviders', []).returns([]);
			mockWorkspaceConfig.withArgs('models.required', []).returns(['openai']);
			mockWorkspaceConfig.withArgs('models.visible', []).returns([]);

			const result = applyModelFilters(models, 'mixed', 'Mixed');

			// No models match "openai" pattern, so result should be empty
			assert.strictEqual(result.length, 0);
		});

		test('models.visible only applies when models.required is not configured', () => {
			const models = [
				createTestModel('gpt-4o', 'GPT-4o'),
				createTestModel('gpt-4o-mini', 'GPT-4o Mini'),
				createTestModel('claude-opus', 'Claude Opus')
			];

			mockWorkspaceConfig.withArgs('unfilteredProviders', []).returns([]);
			mockWorkspaceConfig.withArgs('models.required', []).returns(['gpt']);
			mockWorkspaceConfig.withArgs('models.visible', []).returns(['claude']);

			const result = applyModelFilters(models, 'mixed', 'Mixed');

			// Only gpt models returned, Claude is removed entirely (not just non-selectable)
			assert.strictEqual(result.length, 2);
			assert.ok(result.find(m => m.id === 'gpt-4o'));
			assert.ok(result.find(m => m.id === 'gpt-4o-mini'));
			assert.ok(!result.find(m => m.id === 'claude-opus'));

			// Both returned models should be selectable
			const selectableCount = result.filter(m => isUserSelectable(m)).length;
			assert.strictEqual(selectableCount, 2);
		});

		test('matches models by name when id does not match', () => {
			const models = [createTestModel('model-id-without-filter-string', 'Claude Opus 4')];

			mockWorkspaceConfig.withArgs('unfilteredProviders', []).returns([]);
			mockWorkspaceConfig.withArgs('models.required', []).returns([]);
			mockWorkspaceConfig.withArgs('models.visible', []).returns(['Opus']);

			const result = applyModelFilters(models, 'anthropic', 'Anthropic');

			// Model should be returned
			assert.strictEqual(result.length, 1);
			// Model should be selectable (matches by name)
			assert.ok(isUserSelectable(result[0]));
			assert.strictEqual(result[0].id, 'model-id-without-filter-string');
		});

		test('handles empty model list', () => {
			mockWorkspaceConfig.withArgs('unfilteredProviders', []).returns([]);
			mockWorkspaceConfig.withArgs('models.required', []).returns([]);
			mockWorkspaceConfig.withArgs('models.visible', []).returns(['claude']);

			const result = applyModelFilters([], 'anthropic', 'Anthropic');

			assert.strictEqual(result.length, 0);
		});

		test('handles wildcard patterns in models.required', () => {
			const models = [
				createTestModel('gpt-4o', 'GPT-4o'),
				createTestModel('gpt-4o-mini', 'GPT-4o Mini'),
				createTestModel('gpt-3.5-turbo', 'GPT-3.5 Turbo'),
				createTestModel('claude-opus', 'Claude Opus')
			];

			mockWorkspaceConfig.withArgs('unfilteredProviders', []).returns([]);
			mockWorkspaceConfig.withArgs('models.required', []).returns(['gpt-4*']);
			mockWorkspaceConfig.withArgs('models.visible', []).returns([]);

			const result = applyModelFilters(models, 'mixed', 'Mixed');

			// Only gpt-4 models should be returned
			assert.strictEqual(result.length, 2);
			assert.ok(result.find(m => m.id === 'gpt-4o'));
			assert.ok(result.find(m => m.id === 'gpt-4o-mini'));
		});

		test('handles regex patterns in models.required', () => {
			const models = [
				createTestModel('claude-opus-4', 'Claude Opus 4'),
				createTestModel('claude-3-opus', 'Claude 3 Opus'),
				createTestModel('claude-sonnet', 'Claude Sonnet')
			];

			mockWorkspaceConfig.withArgs('unfilteredProviders', []).returns([]);
			mockWorkspaceConfig.withArgs('models.required', []).returns(['^claude.*opus']);
			mockWorkspaceConfig.withArgs('models.visible', []).returns([]);

			const result = applyModelFilters(models, 'anthropic', 'Anthropic');

			// Only models matching the regex should be returned
			assert.strictEqual(result.length, 2);
			assert.ok(result.find(m => m.id === 'claude-opus-4'));
			assert.ok(result.find(m => m.id === 'claude-3-opus'));
			assert.ok(!result.find(m => m.id === 'claude-sonnet'));
		});
	});
});

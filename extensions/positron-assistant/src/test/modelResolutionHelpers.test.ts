/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import * as extensionModule from '../extension.js';
import * as modelDefinitionsModule from '../modelDefinitions.js';
import {
	findMatchingModelIndex,
	getMaxTokens,
	markDefaultModel
} from '../modelResolutionHelpers.js';
import { DEFAULT_MODEL_CAPABILITIES } from '../constants.js';

suite('Model Resolution Helpers', () => {
	let mockGetConfiguration: sinon.SinonStub;
	let mockLog: {
		warn: sinon.SinonStub;
		trace: sinon.SinonStub;
		info: sinon.SinonStub;
		error: sinon.SinonStub;
	};

	setup(() => {
		// Mock vscode.workspace.getConfiguration
		mockGetConfiguration = sinon.stub();
		sinon.stub(vscode.workspace, 'getConfiguration').returns({
			get: mockGetConfiguration
		} as any);

		// Mock the log module
		mockLog = {
			warn: sinon.stub(),
			trace: sinon.stub(),
			info: sinon.stub(),
			error: sinon.stub()
		};

		// Mock the extension module
		sinon.stub(extensionModule, 'log').value(mockLog);
	});

	teardown(() => {
		sinon.restore();
	});

	suite('findMatchingModelIndex', () => {

		test('returns matching index when model ID matches pattern', () => {
			const models = [
				{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' }
			] as vscode.LanguageModelChatInformation[];

			const result = findMatchingModelIndex(models, 'sonnet-4');

			assert.strictEqual(result, 0);
		});

		test('returns matching index when model name matches pattern', () => {
			const models = [
				{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' }
			] as vscode.LanguageModelChatInformation[];

			const result = findMatchingModelIndex(models, 'Sonnet');

			assert.strictEqual(result, 0);
		});

		test('returns -1 when no match found', () => {
			const models = [
				{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' }
			] as vscode.LanguageModelChatInformation[];

			const result = findMatchingModelIndex(models, 'opus');

			assert.strictEqual(result, -1);
		});

		test('matches case-insensitively on model ID (lowercase pattern)', () => {
			const models = [
				{ id: 'claude-SONNET-4-5', name: 'Claude Sonnet 4.5' }
			] as vscode.LanguageModelChatInformation[];

			const result = findMatchingModelIndex(models, 'sonnet');

			assert.strictEqual(result, 0);
		});

		test('matches case-insensitively on model name (lowercase pattern)', () => {
			const models = [
				{ id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' }
			] as vscode.LanguageModelChatInformation[];

			const result = findMatchingModelIndex(models, 'haiku');

			assert.strictEqual(result, 0);
		});

		test('matches case-insensitively with uppercase pattern', () => {
			const models = [
				{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' }
			] as vscode.LanguageModelChatInformation[];

			const result = findMatchingModelIndex(models, 'SONNET');

			assert.strictEqual(result, 0);
		});

		test('matches case-insensitively on ID with mixed case', () => {
			const models = [
				{ id: 'claude-SONNET-4-5', name: 'Claude Sonnet 4.5' }
			] as vscode.LanguageModelChatInformation[];

			const result = findMatchingModelIndex(models, 'sonnet');

			assert.strictEqual(result, 0);
		});

		test('prefers exact ID match over partial match', () => {
			const models = [
				{ id: 'claude-sonnet-4-5-preview', name: 'Claude Sonnet 4.5 Preview' },
				{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' }
			] as vscode.LanguageModelChatInformation[];

			// Pattern matches first model partially, but second model exactly
			const result = findMatchingModelIndex(models, 'claude-sonnet-4-5');

			assert.strictEqual(result, 1); // Exact match on second model
		});

		test('prefers exact name match over partial match', () => {
			const models = [
				{ id: 'model-a', name: 'Claude Sonnet Extended' },
				{ id: 'model-b', name: 'Claude Sonnet' }
			] as vscode.LanguageModelChatInformation[];

			// Pattern matches first model partially, but second model exactly
			const result = findMatchingModelIndex(models, 'Claude Sonnet');

			assert.strictEqual(result, 1); // Exact match on second model
		});

		test('returns -1 for empty model list', () => {
			const result = findMatchingModelIndex([], 'sonnet');

			assert.strictEqual(result, -1);
		});
	});

	suite('getMaxTokens', () => {
		test('returns global default when no overrides', () => {
			mockGetConfiguration.withArgs('maxInputTokens', {}).returns({});
			mockGetConfiguration.withArgs('maxOutputTokens', {}).returns({});

			// Mock getAllModelDefinitions to return empty array
			sinon.stub(modelDefinitionsModule, 'getAllModelDefinitions').returns([]);

			const resultInput = getMaxTokens('test-model', 'input', 'test-provider');
			const resultOutput = getMaxTokens('test-model', 'output', 'test-provider');

			// Should use DEFAULT_MAX_TOKEN_INPUT (100_000) and DEFAULT_MAX_TOKEN_OUTPUT (4_096)
			assert.strictEqual(resultInput, 100_000);
			assert.strictEqual(resultOutput, 4_096);
		});

		test('uses provider-specific default over global default', () => {
			mockGetConfiguration.withArgs('maxInputTokens', {}).returns({});
			mockGetConfiguration.withArgs('maxOutputTokens', {}).returns({});

			// Mock getAllModelDefinitions to return empty array
			sinon.stub(modelDefinitionsModule, 'getAllModelDefinitions').returns([]);

			const resultInput = getMaxTokens('test-model', 'input', 'test-provider', 200_000, 'Test Provider');
			const resultOutput = getMaxTokens('test-model', 'output', 'test-provider', 8_192, 'Test Provider');

			assert.strictEqual(resultInput, 200_000);
			assert.strictEqual(resultOutput, 8_192);
		});

		test('uses model definition limit over defaults', () => {
			mockGetConfiguration.withArgs('maxInputTokens', {}).returns({});
			mockGetConfiguration.withArgs('maxOutputTokens', {}).returns({});

			// Mock getAllModelDefinitions to return model with specific token limits
			sinon.stub(modelDefinitionsModule, 'getAllModelDefinitions').returns([
				{
					identifier: 'test-model',
					name: 'Test Model',
					maxInputTokens: 175_000,
					maxOutputTokens: 32_000
				}
			]);

			const resultInput = getMaxTokens('test-model', 'input', 'test-provider', 200_000);
			const resultOutput = getMaxTokens('test-model', 'output', 'test-provider', 8_192);

			assert.strictEqual(resultInput, 175_000);
			assert.strictEqual(resultOutput, 32_000);
		});

		test('uses user workspace setting over model definition', () => {
			mockGetConfiguration.withArgs('maxInputTokens', {}).returns({ 'test-model': 250_000 });
			mockGetConfiguration.withArgs('maxOutputTokens', {}).returns({ 'test-model': 64_000 });

			// Mock getAllModelDefinitions to return model with different limits
			sinon.stub(modelDefinitionsModule, 'getAllModelDefinitions').returns([
				{
					identifier: 'test-model',
					name: 'Test Model',
					maxInputTokens: 175_000,
					maxOutputTokens: 32_000
				}
			]);

			const resultInput = getMaxTokens('test-model', 'input', 'test-provider');
			const resultOutput = getMaxTokens('test-model', 'output', 'test-provider');

			assert.strictEqual(resultInput, 250_000);
			assert.strictEqual(resultOutput, 64_000);
		});

	});

	suite('markDefaultModel', () => {
		test('marks user-preferred model as default', () => {
			const models = [
				{
					id: 'claude-opus-4-1',
					name: 'Claude Opus 4.1',
					family: 'anthropic-api',
					version: '1.0',
					maxInputTokens: 200_000,
					maxOutputTokens: 8_192,
					capabilities: DEFAULT_MODEL_CAPABILITIES,
					isDefault: false,
					isUserSelectable: true
				},
				{
					id: 'claude-sonnet-4-5',
					name: 'Claude Sonnet 4.5',
					family: 'anthropic-api',
					version: '1.0',
					maxInputTokens: 200_000,
					maxOutputTokens: 64_000,
					capabilities: DEFAULT_MODEL_CAPABILITIES,
					isDefault: false,
					isUserSelectable: true
				}
			];

			// Mock workspace configuration to simulate user preference for opus
			const providerPreferences = { 'anthropic-api': 'opus' };
			mockGetConfiguration.withArgs('models.preference.byProvider').returns(providerPreferences);

			const result = markDefaultModel(models as any, 'anthropic-api', 'claude-sonnet-4');

			const defaultModel = result.find((m: any) => m.isDefault);
			assert.strictEqual(defaultModel.id, 'claude-opus-4-1');
			const nonDefaultModels = result.filter((m: any) => !m.isDefault);
			assert.strictEqual(nonDefaultModels.length, 1);
			assert.strictEqual(nonDefaultModels[0].id, 'claude-sonnet-4-5');
		});

		test('marks first model as default when no user preference matches', () => {
			const models = [
				{
					id: 'claude-a',
					name: 'Claude A',
					family: 'anthropic-api',
					version: '1.0',
					maxInputTokens: 200_000,
					maxOutputTokens: 8_192,
					capabilities: DEFAULT_MODEL_CAPABILITIES,
					isDefault: false,
					isUserSelectable: true
				},
				{
					id: 'claude-b',
					name: 'Claude B',
					family: 'anthropic-api',
					version: '1.0',
					maxInputTokens: 200_000,
					maxOutputTokens: 64_000,
					capabilities: DEFAULT_MODEL_CAPABILITIES,
					isDefault: false,
					isUserSelectable: true
				}
			];

			// Mock workspace configuration with no matching preference
			const providerPreferences = { 'anthropic-api': 'nonexistent' };
			mockGetConfiguration.withArgs('models.preference.byProvider').returns(providerPreferences);

			const result = markDefaultModel(models as any, 'anthropic-api', 'claude-sonnet-4');

			assert.strictEqual(result[0].isDefault, true);
			assert.strictEqual(result[1].isDefault, false);
		});

		test('uses defaultMatch when no user preference is set', () => {
			const models = [
				{
					id: 'claude-opus-4-1',
					name: 'Claude Opus 4.1',
					family: 'anthropic-api',
					version: '1.0',
					maxInputTokens: 200_000,
					maxOutputTokens: 8_192,
					capabilities: DEFAULT_MODEL_CAPABILITIES,
					isDefault: false,
					isUserSelectable: true
				},
				{
					id: 'claude-sonnet-4-5',
					name: 'Claude Sonnet 4.5',
					family: 'anthropic-api',
					version: '1.0',
					maxInputTokens: 200_000,
					maxOutputTokens: 64_000,
					capabilities: DEFAULT_MODEL_CAPABILITIES,
					isDefault: false,
					isUserSelectable: true
				}
			];

			// Mock workspace configuration with no default models
			mockGetConfiguration.withArgs('models.preference.byProvider').returns({});

			const result = markDefaultModel(models as any, 'anthropic-api', 'sonnet-4'); const defaultModel = result.find((m: any) => m.isDefault);
			assert.strictEqual(defaultModel.id, 'claude-sonnet-4-5');
			const nonDefaultModels = result.filter((m: any) => !m.isDefault);
			assert.strictEqual(nonDefaultModels.length, 1);
			assert.strictEqual(nonDefaultModels[0].id, 'claude-opus-4-1');
		});

		test('ensures only one model is marked as default', () => {
			const models = [
				{
					id: 'claude-a',
					name: 'Claude A',
					family: 'anthropic-api',
					version: '1.0',
					maxInputTokens: 200_000,
					maxOutputTokens: 8_192,
					capabilities: DEFAULT_MODEL_CAPABILITIES,
					isDefault: false,
					isUserSelectable: true
				},
				{
					id: 'claude-b',
					name: 'Claude B',
					family: 'anthropic-api',
					version: '1.0',
					maxInputTokens: 200_000,
					maxOutputTokens: 64_000,
					capabilities: DEFAULT_MODEL_CAPABILITIES,
					isDefault: false,
					isUserSelectable: true
				},
				{
					id: 'claude-c',
					name: 'Claude C',
					family: 'anthropic-api',
					version: '1.0',
					maxInputTokens: 200_000,
					maxOutputTokens: 32_000,
					capabilities: DEFAULT_MODEL_CAPABILITIES,
					isDefault: false,
					isUserSelectable: true
				}
			];

			// Mock workspace configuration that would match multiple models
			const providerPreferences = { 'anthropic-api': 'claude' };
			mockGetConfiguration.withArgs('models.preference.byProvider').returns(providerPreferences);

			const result = markDefaultModel(models as any, 'anthropic-api', 'claude-sonnet-4');

			const defaultModels_result = result.filter((m: any) => m.isDefault);
			assert.strictEqual(defaultModels_result.length, 1);
			assert.strictEqual(defaultModels_result[0].id, 'claude-a'); // First match wins
		});

		test('handles empty model list', () => {
			const result = markDefaultModel([], 'anthropic-api', 'claude-sonnet-4');

			assert.deepStrictEqual(result, []);
		});

		test('preserves model properties while updating isDefault', () => {
			const models = [
				{
					id: 'test-model',
					name: 'Test Model',
					family: 'test-family',
					version: '1.0',
					maxInputTokens: 100_000,
					maxOutputTokens: 4_096,
					capabilities: { imageInput: false, toolCalling: true, agentMode: false },
					isDefault: false,
					isUserSelectable: true
				}
			];

			// Mock workspace configuration with no default models
			mockGetConfiguration.withArgs('models.preference.byProvider').returns({});

			const result = markDefaultModel(models as any, 'test-provider'); assert.strictEqual(result.length, 1);
			const model = result[0];
			assert.strictEqual(model.id, 'test-model');
			assert.strictEqual(model.name, 'Test Model');
			assert.strictEqual(model.family, 'test-family');
			assert.strictEqual(model.version, '1.0');
			assert.strictEqual(model.maxInputTokens, 100_000);
			assert.strictEqual(model.maxOutputTokens, 4_096);
			assert.deepStrictEqual(model.capabilities, { imageInput: false, toolCalling: true, agentMode: false });
			assert.strictEqual(model.isDefault, true); // Should be marked as default (first/only model)
			assert.strictEqual(model.isUserSelectable, true);
		});

		test('prioritizes user config over defaultMatch', () => {
			const models = [
				{
					id: 'claude-opus-4-1',
					name: 'Claude Opus 4.1',
					family: 'anthropic-api',
					version: '1.0',
					maxInputTokens: 200_000,
					maxOutputTokens: 8_192,
					capabilities: DEFAULT_MODEL_CAPABILITIES,
					isDefault: false,
					isUserSelectable: true
				},
				{
					id: 'claude-sonnet-4-5',
					name: 'Claude Sonnet 4.5',
					family: 'anthropic-api',
					version: '1.0',
					maxInputTokens: 200_000,
					maxOutputTokens: 64_000,
					capabilities: DEFAULT_MODEL_CAPABILITIES,
					isDefault: false,
					isUserSelectable: true
				}
			];

			// User wants opus, but defaultMatch suggests sonnet - user config should win
			const providerPreferences = { 'anthropic-api': 'opus' };
			mockGetConfiguration.withArgs('models.preference.byProvider').returns(providerPreferences);

			const result = markDefaultModel(models as any, 'anthropic-api', 'sonnet-4'); const defaultModel = result.find((m: any) => m.isDefault);
			assert.strictEqual(defaultModel.id, 'claude-opus-4-1');
		});
	});
});

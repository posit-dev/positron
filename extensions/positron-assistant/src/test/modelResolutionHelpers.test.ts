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
	isDefaultUserModel,
	getMaxTokens,
	markDefaultModel
} from '../modelResolutionHelpers.js';

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

	suite('isDefaultUserModel', () => {
		test('returns true when model ID matches user-configured default', () => {
			const defaultModels = { 'anthropic-api': 'sonnet-4' };
			mockGetConfiguration.withArgs('defaultModels').returns(defaultModels);

			const result = isDefaultUserModel('anthropic-api', 'claude-sonnet-4-5', 'Claude Sonnet 4.5');

			assert.strictEqual(result, true);
		});

		test('returns true when model name matches user-configured default', () => {
			const defaultModels = { 'anthropic-api': 'Sonnet' };
			mockGetConfiguration.withArgs('defaultModels').returns(defaultModels);

			const result = isDefaultUserModel('anthropic-api', 'claude-sonnet-4-5', 'Claude Sonnet 4.5');

			assert.strictEqual(result, true);
		});

		test('returns false when no match and no defaultMatch provided', () => {
			const defaultModels = { 'anthropic-api': 'opus' };
			mockGetConfiguration.withArgs('defaultModels').returns(defaultModels);

			const result = isDefaultUserModel('anthropic-api', 'claude-sonnet-4-5', 'Claude Sonnet 4.5');

			assert.strictEqual(result, false);
		});

		test('returns true when ID matches defaultMatch pattern', () => {
			mockGetConfiguration.withArgs('defaultModels').returns({});

			const result = isDefaultUserModel('anthropic-api', 'claude-sonnet-4-5', 'Claude Sonnet 4.5', 'sonnet-4');

			assert.strictEqual(result, true);
		});

		test('prioritizes user config over defaultMatch', () => {
			const defaultModels = { 'anthropic-api': 'opus' };
			mockGetConfiguration.withArgs('defaultModels').returns(defaultModels);

			// User wants opus, but defaultMatch suggests sonnet - user config should win
			const result = isDefaultUserModel('anthropic-api', 'claude-opus-4-1', 'Claude Opus 4.1', 'sonnet-4');

			assert.strictEqual(result, true);
		});

		test('handles provider not in defaultModels config', () => {
			const defaultModels = { 'anthropic-api': 'sonnet' };
			mockGetConfiguration.withArgs('defaultModels').returns(defaultModels);

			const result = isDefaultUserModel('openai-api', 'gpt-4', 'GPT-4');

			assert.strictEqual(result, false);
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
					capabilities: { vision: true, toolCalling: true, agentMode: true },
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
					capabilities: { vision: true, toolCalling: true, agentMode: true },
					isDefault: false,
					isUserSelectable: true
				}
			];

			// Mock workspace configuration to simulate user preference for opus
			const defaultModels = { 'anthropic-api': 'opus' };
			mockGetConfiguration.withArgs('defaultModels').returns(defaultModels);

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
					capabilities: { vision: true, toolCalling: true, agentMode: true },
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
					capabilities: { vision: true, toolCalling: true, agentMode: true },
					isDefault: false,
					isUserSelectable: true
				}
			];

			// Mock workspace configuration with no matching preference
			const defaultModels = { 'anthropic-api': 'nonexistent' };
			mockGetConfiguration.withArgs('defaultModels').returns(defaultModels);

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
					capabilities: { vision: true, toolCalling: true, agentMode: true },
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
					capabilities: { vision: true, toolCalling: true, agentMode: true },
					isDefault: false,
					isUserSelectable: true
				}
			];

			// Mock workspace configuration with no default models
			mockGetConfiguration.withArgs('defaultModels').returns({});

			const result = markDefaultModel(models as any, 'anthropic-api', 'sonnet-4');

			const defaultModel = result.find((m: any) => m.isDefault);
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
					capabilities: { vision: true, toolCalling: true, agentMode: true },
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
					capabilities: { vision: true, toolCalling: true, agentMode: true },
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
					capabilities: { vision: true, toolCalling: true, agentMode: true },
					isDefault: false,
					isUserSelectable: true
				}
			];

			// Mock workspace configuration that would match multiple models
			const defaultModels = { 'anthropic-api': 'claude' };
			mockGetConfiguration.withArgs('defaultModels').returns(defaultModels);

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
					capabilities: { vision: false, toolCalling: true, agentMode: false },
					isDefault: false,
					isUserSelectable: true
				}
			];

			// Mock workspace configuration with no default models
			mockGetConfiguration.withArgs('defaultModels').returns({});

			const result = markDefaultModel(models as any, 'test-provider');

			assert.strictEqual(result.length, 1);
			const model = result[0];
			assert.strictEqual(model.id, 'test-model');
			assert.strictEqual(model.name, 'Test Model');
			assert.strictEqual(model.family, 'test-family');
			assert.strictEqual(model.version, '1.0');
			assert.strictEqual(model.maxInputTokens, 100_000);
			assert.strictEqual(model.maxOutputTokens, 4_096);
			assert.deepStrictEqual(model.capabilities, { vision: false, toolCalling: true, agentMode: false });
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
					capabilities: { vision: true, toolCalling: true, agentMode: true },
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
					capabilities: { vision: true, toolCalling: true, agentMode: true },
					isDefault: false,
					isUserSelectable: true
				}
			];

			// User wants opus, but defaultMatch suggests sonnet - user config should win
			const defaultModels = { 'anthropic-api': 'opus' };
			mockGetConfiguration.withArgs('defaultModels').returns(defaultModels);

			const result = markDefaultModel(models as any, 'anthropic-api', 'sonnet-4');

			const defaultModel = result.find((m: any) => m.isDefault);
			assert.strictEqual(defaultModel.id, 'claude-opus-4-1');
		});
	});
});

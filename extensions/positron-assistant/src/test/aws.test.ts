/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as positron from 'positron';
import * as sinon from 'sinon';
import { AWSModelProvider } from '../providers/aws/awsBedrockProvider.js';
import { ModelConfig } from '../config.js';
import * as modelDefinitionsModule from '../modelDefinitions.js';
import * as helpersModule from '../modelResolutionHelpers.js';

suite('AWSModelProvider', () => {
	let mockWorkspaceConfig: sinon.SinonStub;
	let mockConfig: ModelConfig;
	let awsProvider: AWSModelProvider;

	setup(() => {
		// Mock vscode.workspace.getConfiguration
		mockWorkspaceConfig = sinon.stub();
		sinon.stub(vscode.workspace, 'getConfiguration').callsFake((section?: string) => {
			if (section === 'positron.assistant.providerVariables') {
				return {
					get: sinon.stub().withArgs('bedrock', {}).returns({})
				} as any;
			}
			return {
				get: mockWorkspaceConfig
			} as any;
		});

		mockConfig = {
			id: 'aws-bedrock-test',
			provider: 'amazon-bedrock',
			type: positron.PositronLanguageModelType.Chat,
			name: 'AWS Bedrock Test',
			model: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
			apiKey: undefined,
			maxInputTokens: 200000,
			maxOutputTokens: 8192
		};

		// Mock the applyModelFilters import
		mockWorkspaceConfig.withArgs('unfilteredProviders', []).returns([]);
		mockWorkspaceConfig.withArgs('filterModels', []).returns([]);

		awsProvider = new AWSModelProvider(mockConfig);
	});

	teardown(() => {
		sinon.restore();
	});

	test('provider initializes with correct source configuration', () => {
		const source = AWSModelProvider.source;

		assert.strictEqual(source.provider.id, 'amazon-bedrock');
		assert.strictEqual(source.provider.displayName, 'Amazon Bedrock');
		assert.strictEqual(source.type, positron.PositronLanguageModelType.Chat);
		assert.ok(source.supportedOptions?.includes('toolCalls'));
		assert.ok(source.supportedOptions?.includes('autoconfigure'));
	});

	test('provider uses correct default model', () => {
		const source = AWSModelProvider.source;

		assert.strictEqual(source.defaults?.name, 'Claude 4 Sonnet Bedrock');
		assert.strictEqual(source.defaults?.model, 'us.anthropic.claude-sonnet-4-20250514-v1:0');
		assert.strictEqual(source.defaults?.toolCalls, true);
	});

	test('legacy models regex patterns are defined', () => {
		assert.ok(Array.isArray(AWSModelProvider.LEGACY_MODELS_REGEX));
		assert.ok(AWSModelProvider.LEGACY_MODELS_REGEX.length > 0);
		assert.ok(AWSModelProvider.LEGACY_MODELS_REGEX.some(pattern => pattern.includes('claude-3-opus')));
		assert.ok(AWSModelProvider.LEGACY_MODELS_REGEX.some(pattern => pattern.includes('claude-3-5-sonnet')));
	});

	test('supported Bedrock providers are defined', () => {
		assert.ok(Array.isArray(AWSModelProvider.SUPPORTED_BEDROCK_PROVIDERS));
		assert.ok(AWSModelProvider.SUPPORTED_BEDROCK_PROVIDERS.includes('Anthropic'));
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
				const result = (awsProvider as any).retrieveModelsFromConfig();
				assert.strictEqual(result, undefined);
			});

			test('returns configured models when built-in models exist', () => {
				const builtInModels = [
					{
						name: 'Claude 4 Sonnet Bedrock',
						identifier: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
						maxInputTokens: 200000,
						maxOutputTokens: 8192
					}
				];
				mockModelDefinitions.returns(builtInModels);

				const mockModelInfo = {
					id: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
					name: 'Claude 4 Sonnet Bedrock',
					family: 'amazon-bedrock',
					version: '1.0',
					maxInputTokens: 200000,
					maxOutputTokens: 8192,
					capabilities: {},
					isDefault: true,
					isUserSelectable: true
				};
				mockHelpers.createModelInfo.returns(mockModelInfo);
				mockHelpers.markDefaultModel.returns([mockModelInfo]);

				const result = (awsProvider as any).retrieveModelsFromConfig();

				assert.ok(result, 'Should return built-in models');
				assert.strictEqual(result.length, 1);
				assert.strictEqual(result[0].id, 'us.anthropic.claude-sonnet-4-20250514-v1:0');
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
						name: 'Claude 4 Sonnet Bedrock',
						identifier: 'us.anthropic.claude-sonnet-4-20250514-v1:0'
					}
				];
				mockModelDefinitions.returns(configuredModels);

				const mockModelInfo = {
					id: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
					name: 'Claude 4 Sonnet Bedrock',
					isDefault: true,
					isUserSelectable: true
				};
				mockHelpers.createModelInfo.returns(mockModelInfo);
				mockHelpers.markDefaultModel.returns([mockModelInfo]);

				const result = await awsProvider.resolveModels(cancellationToken);

				assert.ok(result, 'Should return configured models');
				assert.strictEqual(result.length, 1);
				assert.strictEqual(result[0].id, 'us.anthropic.claude-sonnet-4-20250514-v1:0');
			});
		});
	});
});

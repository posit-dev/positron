/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as positron from 'positron';
import * as sinon from 'sinon';
import { AzureModelProvider } from '../providers/azure/azureProvider.js';
import { ModelConfig } from '../config.js';
import * as modelDefinitionsModule from '../modelDefinitions.js';
import * as helpersModule from '../modelResolutionHelpers.js';

suite('AzureModelProvider', () => {
	let mockWorkspaceConfig: sinon.SinonStub;
	let mockConfig: ModelConfig;
	let azureProvider: AzureModelProvider;

	setup(() => {
		// Mock vscode.workspace.getConfiguration
		mockWorkspaceConfig = sinon.stub();
		sinon.stub(vscode.workspace, 'getConfiguration').returns({
			get: mockWorkspaceConfig
		} as any);

		mockConfig = {
			id: 'azure-test',
			provider: 'azure',
			type: positron.PositronLanguageModelType.Chat,
			name: 'Azure GPT-4o Test',
			model: 'gpt-4o',
			apiKey: 'test-azure-api-key', // pragma: allowlist secret
			resourceName: 'test-resource',
			maxInputTokens: 128000,
			maxOutputTokens: 16384
		};

		// Mock the applyModelFilters import
		mockWorkspaceConfig.withArgs('unfilteredProviders', []).returns([]);
		mockWorkspaceConfig.withArgs('filterModels', []).returns([]);

		azureProvider = new AzureModelProvider(mockConfig);
	});

	teardown(() => {
		sinon.restore();
	});

	test('provider initializes with correct source configuration', () => {
		const source = AzureModelProvider.source;

		assert.strictEqual(source.provider.id, 'azure');
		assert.strictEqual(source.provider.displayName, 'Azure');
		assert.strictEqual(source.type, positron.PositronLanguageModelType.Chat);
		assert.ok(source.supportedOptions?.includes('resourceName'));
		assert.ok(source.supportedOptions?.includes('apiKey'));
		assert.ok(source.supportedOptions?.includes('toolCalls'));
	});

	test('provider uses correct default model', () => {
		const source = AzureModelProvider.source;

		assert.strictEqual(source.defaults?.name, 'GPT 4o');
		assert.strictEqual(source.defaults?.model, 'gpt-4o');
		assert.strictEqual(source.defaults?.toolCalls, true);
		assert.strictEqual(source.defaults?.resourceName, undefined);
	});

	test('provider requires resourceName configuration', () => {
		assert.strictEqual(azureProvider['_config'].resourceName, 'test-resource');
	});

	test('provider accepts custom resource names', () => {
		const customConfig: ModelConfig = {
			...mockConfig,
			resourceName: 'custom-azure-resource'
		};

		const customProvider = new AzureModelProvider(customConfig);

		assert.strictEqual(customProvider['_config'].resourceName, 'custom-azure-resource');
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
				const result = (azureProvider as any).retrieveModelsFromConfig();
				assert.strictEqual(result, undefined);
			});

			test('returns configured models when built-in models exist', () => {
				const builtInModels = [
					{
						name: 'GPT 4o',
						identifier: 'gpt-4o',
						maxInputTokens: 128000,
						maxOutputTokens: 16384
					}
				];
				mockModelDefinitions.returns(builtInModels);

				const mockModelInfo = {
					id: 'gpt-4o',
					name: 'GPT 4o',
					family: 'azure',
					version: '1.0',
					maxInputTokens: 128000,
					maxOutputTokens: 16384,
					capabilities: {},
					isDefault: true,
					isUserSelectable: true
				};
				mockHelpers.createModelInfo.returns(mockModelInfo);
				mockHelpers.markDefaultModel.returns([mockModelInfo]);

				const result = (azureProvider as any).retrieveModelsFromConfig();

				assert.ok(result, 'Should return built-in models');
				assert.strictEqual(result.length, 1);
				assert.strictEqual(result[0].id, 'gpt-4o');
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
						name: 'GPT 4o',
						identifier: 'gpt-4o'
					}
				];
				mockModelDefinitions.returns(configuredModels);

				const mockModelInfo = {
					id: 'gpt-4o',
					name: 'GPT 4o',
					isDefault: true,
					isUserSelectable: true
				};
				mockHelpers.createModelInfo.returns(mockModelInfo);
				mockHelpers.markDefaultModel.returns([mockModelInfo]);

				const result = await azureProvider.resolveModels(cancellationToken);

				assert.ok(result, 'Should return configured models');
				assert.strictEqual(result.length, 1);
				assert.strictEqual(result[0].id, 'gpt-4o');
			});
		});
	});
});

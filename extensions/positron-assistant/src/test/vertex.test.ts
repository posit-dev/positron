/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as positron from 'positron';
import * as sinon from 'sinon';
import { VertexModelProvider } from '../providers/google/vertexProvider.js';
import { ModelConfig } from '../config.js';
import * as modelDefinitionsModule from '../modelDefinitions.js';
import * as helpersModule from '../modelResolutionHelpers.js';

suite('VertexModelProvider', () => {
	let mockWorkspaceConfig: sinon.SinonStub;
	let mockConfig: ModelConfig;
	let vertexProvider: VertexModelProvider;

	setup(() => {
		// Mock vscode.workspace.getConfiguration
		mockWorkspaceConfig = sinon.stub();
		sinon.stub(vscode.workspace, 'getConfiguration').returns({
			get: mockWorkspaceConfig
		} as any);

		mockConfig = {
			id: 'vertex-test',
			provider: 'vertex',
			type: positron.PositronLanguageModelType.Chat,
			name: 'Gemini 2.0 Flash',
			model: 'gemini-2.0-flash-exp',
			apiKey: undefined,
			project: 'test-project',
			location: 'us-central1',
			maxInputTokens: 1000000,
			maxOutputTokens: 8192
		};

		// Mock the applyModelFilters import
		mockWorkspaceConfig.withArgs('unfilteredProviders', []).returns([]);
		mockWorkspaceConfig.withArgs('filterModels', []).returns([]);

		vertexProvider = new VertexModelProvider(mockConfig);
	});

	teardown(() => {
		sinon.restore();
	});

	test('provider initializes with correct source configuration', () => {
		const source = VertexModelProvider.source;

		assert.strictEqual(source.provider.id, 'vertex');
		assert.strictEqual(source.provider.displayName, 'Google Vertex AI');
		assert.strictEqual(source.type, positron.PositronLanguageModelType.Chat);
		assert.ok(source.supportedOptions?.includes('toolCalls'));
		assert.ok(source.supportedOptions?.includes('project'));
		assert.ok(source.supportedOptions?.includes('location'));
	});

	test('provider uses correct default model', () => {
		const source = VertexModelProvider.source;

		assert.strictEqual(source.defaults?.name, 'Gemini 2.0 Flash');
		assert.strictEqual(source.defaults?.model, 'gemini-2.0-flash-exp');
		assert.strictEqual(source.defaults?.toolCalls, true);
	});

	test('provider requires project and location configuration', () => {
		assert.strictEqual(vertexProvider['_config'].project, 'test-project');
		assert.strictEqual(vertexProvider['_config'].location, 'us-central1');
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
				const result = (vertexProvider as any).retrieveModelsFromConfig();
				assert.strictEqual(result, undefined);
			});

			test('returns configured models when built-in models exist', () => {
				const builtInModels = [
					{
						name: 'Gemini 2.0 Flash',
						identifier: 'gemini-2.0-flash-exp',
						maxInputTokens: 1000000,
						maxOutputTokens: 8192
					}
				];
				mockModelDefinitions.returns(builtInModels);

				const mockModelInfo = {
					id: 'gemini-2.0-flash-exp',
					name: 'Gemini 2.0 Flash',
					family: 'vertex',
					version: '1.0',
					maxInputTokens: 1000000,
					maxOutputTokens: 8192,
					capabilities: {},
					isDefault: true,
					isUserSelectable: true
				};
				mockHelpers.createModelInfo.returns(mockModelInfo);
				mockHelpers.markDefaultModel.returns([mockModelInfo]);

				const result = (vertexProvider as any).retrieveModelsFromConfig();

				assert.ok(result, 'Should return built-in models');
				assert.strictEqual(result.length, 1);
				assert.strictEqual(result[0].id, 'gemini-2.0-flash-exp');
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
						name: 'Gemini 2.0 Flash',
						identifier: 'gemini-2.0-flash-exp'
					}
				];
				mockModelDefinitions.returns(configuredModels);

				const mockModelInfo = {
					id: 'gemini-2.0-flash-exp',
					name: 'Gemini 2.0 Flash',
					isDefault: true,
					isUserSelectable: true
				};
				mockHelpers.createModelInfo.returns(mockModelInfo);
				mockHelpers.markDefaultModel.returns([mockModelInfo]);

				const result = await vertexProvider.resolveModels(cancellationToken);

				assert.ok(result, 'Should return configured models');
				assert.strictEqual(result.length, 1);
				assert.strictEqual(result[0].id, 'gemini-2.0-flash-exp');
			});
		});
	});
});

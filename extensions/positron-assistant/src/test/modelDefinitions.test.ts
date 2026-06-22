/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { getAllModelDefinitions, getCustomModels } from '../modelDefinitions.js';
import { stubGetModelProviders } from './utils.js';

suite('Model Definitions', () => {
	let mockWorkspaceConfig: sinon.SinonStub;

	setup(() => {
		// Mock vscode.workspace.getConfiguration
		mockWorkspaceConfig = sinon.stub();
		sinon.stub(vscode.workspace, 'getConfiguration').callsFake(() => ({
			get: mockWorkspaceConfig
		}) as unknown as vscode.WorkspaceConfiguration);

		// Mock getModelProviders to return test providers
		stubGetModelProviders();
	});

	teardown(() => {
		sinon.restore();
	});

	suite('getAllModelDefinitions', () => {
		test('prioritizes custom models over built-in', () => {
			const userModels = [
				{
					name: 'User Claude',
					identifier: 'user-claude'
				}
			];
			// Test with individual models.overrides setting
			mockWorkspaceConfig.withArgs('models.overrides.anthropic').returns(userModels);

			const result = getAllModelDefinitions('anthropic-api');

			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].name, 'User Claude');
			assert.strictEqual(result[0].identifier, 'user-claude');
		});
	});
});

suite('Model Definitions - getCustomModels', () => {
	let mockAiConfig: sinon.SinonStub;
	let mockLegacyConfig: sinon.SinonStub;

	setup(() => {
		mockAiConfig = sinon.stub();
		mockLegacyConfig = sinon.stub();
		sinon.stub(vscode.workspace, 'getConfiguration').callsFake((section?: string) => {
			if (section === 'ai') {
				return { get: mockAiConfig } as unknown as vscode.WorkspaceConfiguration;
			}
			return { get: mockLegacyConfig } as unknown as vscode.WorkspaceConfiguration;
		});
		stubGetModelProviders();
	});

	teardown(() => {
		sinon.restore();
	});

	test('reads from ai.models.* when populated', () => {
		const newModels = [{ name: 'New Claude', identifier: 'new-claude' }];
		mockAiConfig.withArgs('models.anthropic').returns(newModels);

		const result = getCustomModels('anthropic-api');

		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].name, 'New Claude');
	});

	test('falls back to legacy positron.assistant.models.overrides.* when ai.models.* is empty', () => {
		const legacyModels = [{ name: 'Legacy Claude', identifier: 'legacy-claude' }];
		mockAiConfig.withArgs('models.anthropic').returns([]);
		mockLegacyConfig.withArgs('models.overrides.anthropic').returns(legacyModels);

		const result = getCustomModels('anthropic-api');

		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].name, 'Legacy Claude');
	});

	test('returns empty array when both namespaces are empty', () => {
		mockAiConfig.returns([]);
		mockLegacyConfig.returns([]);

		const result = getCustomModels('anthropic-api');

		assert.strictEqual(result.length, 0);
	});

	test('google provider reads from ai.models.gemini (not ai.models.google)', () => {
		const geminiModels = [{ name: 'Gemini Ultra', identifier: 'gemini-ultra' }];
		mockAiConfig.withArgs('models.gemini').returns(geminiModels);

		const result = getCustomModels('google');

		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].name, 'Gemini Ultra');
	});

	test('google provider falls back to legacy positron.assistant.models.overrides.google', () => {
		const legacyModels = [{ name: 'Legacy Gemini', identifier: 'legacy-gemini' }];
		mockAiConfig.withArgs('models.gemini').returns([]);
		mockLegacyConfig.withArgs('models.overrides.google').returns(legacyModels);

		const result = getCustomModels('google');

		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].name, 'Legacy Gemini');
	});
});

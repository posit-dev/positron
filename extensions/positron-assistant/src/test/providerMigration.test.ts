/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import * as providersModule from '../providers';
import {
	performProviderMigration,
	performModelPreferencesMigration,
	performCustomModelsMigration
} from '../providerMigration.js';

interface MockStubs {
	mockInspect: sinon.SinonStub;
	mockUpdate: sinon.SinonStub;
}

function setupMigrationTest(providers: any[]): MockStubs {
	const mockInspect = sinon.stub();
	const mockUpdate = sinon.stub().resolves();

	sinon.stub(vscode.workspace, 'getConfiguration').callsFake(() => ({
		inspect: mockInspect,
		update: mockUpdate
	}) as unknown as vscode.WorkspaceConfiguration);

	sinon.stub(vscode.window, 'showInformationMessage').resolves();
	// eslint-disable-next-line local/code-no-any-casts
	sinon.stub(providersModule, 'getModelProviders').returns(providers as any);

	return { mockInspect, mockUpdate };
}

suite('Provider Migration Tests', () => {
	let stubs: MockStubs;

	setup(() => {
		stubs = setupMigrationTest([
			{
				source: {
					provider: {
						id: 'anthropic-api',
						displayName: 'Anthropic',
						settingName: 'anthropic'
					}
				}
			},
			{
				source: {
					provider: {
						id: 'copilot-auth',
						displayName: 'GitHub Copilot',
						settingName: 'githubCopilot'
					}
				}
			},
			{
				source: {
					provider: {
						id: 'openai-api',
						displayName: 'OpenAI',
						settingName: 'openAI'
					}
				}
			}
		]);
	});

	teardown(() => {
		sinon.restore();
	});

	test('migrates from enabledProviders array to individual settings', async () => {
		stubs.mockInspect.withArgs('enabledProviders').returns({
			globalValue: ['anthropic-api', 'copilot-auth', 'openai-api']
		});
		stubs.mockInspect.withArgs('provider.anthropic.enable').returns({});
		stubs.mockInspect.withArgs('provider.githubCopilot.enable').returns({});
		stubs.mockInspect.withArgs('provider.openAI.enable').returns({});

		await performProviderMigration();

		const calls = stubs.mockUpdate.getCalls();
		const anthropicCall = calls.find(call => call.args[0] === 'provider.anthropic.enable');
		const copilotCall = calls.find(call => call.args[0] === 'provider.githubCopilot.enable');
		const openaiCall = calls.find(call => call.args[0] === 'provider.openAI.enable');
		const removeCall = calls.find(call => call.args[0] === 'enabledProviders');

		assert.ok(anthropicCall);
		assert.strictEqual(anthropicCall.args[1], true);
		assert.strictEqual(anthropicCall.args[2], vscode.ConfigurationTarget.Global);

		assert.ok(copilotCall);
		assert.strictEqual(copilotCall.args[1], true);

		assert.ok(openaiCall);
		assert.strictEqual(openaiCall.args[1], true);

		assert.ok(removeCall);
		assert.strictEqual(removeCall.args[1], undefined);
	});

	test('does not overwrite existing individual settings', async () => {
		stubs.mockInspect.withArgs('enabledProviders').returns({
			globalValue: ['anthropic-api', 'openai-api']
		});
		stubs.mockInspect.withArgs('provider.anthropic.enable').returns({
			globalValue: false
		});
		stubs.mockInspect.withArgs('provider.openAI.enable').returns({});

		await performProviderMigration();

		const calls = stubs.mockUpdate.getCalls();
		const anthropicCall = calls.find(call => call.args[0] === 'provider.anthropic.enable');
		const openaiCall = calls.find(call => call.args[0] === 'provider.openAI.enable');

		assert.ok(!anthropicCall);
		assert.ok(openaiCall);
		assert.strictEqual(openaiCall.args[1], true);
	});

	test('handles invalid provider IDs gracefully', async () => {
		stubs.mockInspect.withArgs('enabledProviders').returns({
			globalValue: ['invalid-provider-id', 'anthropic-api']
		});
		stubs.mockInspect.withArgs('provider.anthropic.enable').returns({});

		await performProviderMigration();

		const calls = stubs.mockUpdate.getCalls();
		const anthropicCall = calls.find(call => call.args[0] === 'provider.anthropic.enable');
		const removeCall = calls.find(call => call.args[0] === 'enabledProviders');
		const hasInvalidSetting = calls.some(call => call.args[0].includes('invalid'));

		assert.ok(anthropicCall);
		assert.ok(removeCall);
		assert.ok(!hasInvalidSetting);
	});
});

suite('Model Preferences Migration Tests', () => {
	let stubs: MockStubs;

	setup(() => {
		stubs = setupMigrationTest([
			{
				source: {
					provider: {
						id: 'anthropic-api',
						displayName: 'Anthropic',
						settingName: 'anthropic'
					}
				}
			},
			{
				source: {
					provider: {
						id: 'openai-api',
						displayName: 'OpenAI',
						settingName: 'openAI'
					}
				}
			}
		]);
	});

	teardown(() => {
		sinon.restore();
	});

	test('migrates model preferences from byProvider object to individual settings', async () => {
		stubs.mockInspect.withArgs('models.preference.byProvider').returns({
			globalValue: {
				'anthropic-api': 'claude-opus-4',
				'openai-api': 'gpt-4'
			}
		});
		stubs.mockInspect.withArgs('models.preference.anthropic').returns({});
		stubs.mockInspect.withArgs('models.preference.openAI').returns({});

		await performModelPreferencesMigration();

		const calls = stubs.mockUpdate.getCalls();
		const anthropicCall = calls.find(call => call.args[0] === 'models.preference.anthropic');
		const openaiCall = calls.find(call => call.args[0] === 'models.preference.openAI');
		const removeCall = calls.find(call => call.args[0] === 'models.preference.byProvider');

		assert.ok(anthropicCall);
		assert.strictEqual(anthropicCall.args[1], 'claude-opus-4');
		assert.strictEqual(anthropicCall.args[2], vscode.ConfigurationTarget.Global);

		assert.ok(openaiCall);
		assert.strictEqual(openaiCall.args[1], 'gpt-4');

		assert.ok(removeCall);
		assert.strictEqual(removeCall.args[1], undefined);
	});

	test('does not overwrite existing model preference settings', async () => {
		stubs.mockInspect.withArgs('models.preference.byProvider').returns({
			globalValue: {
				'anthropic-api': 'claude-opus-4',
				'openai-api': 'gpt-4'
			}
		});
		stubs.mockInspect.withArgs('models.preference.anthropic').returns({
			globalValue: 'claude-sonnet-4'
		});
		stubs.mockInspect.withArgs('models.preference.openAI').returns({});

		await performModelPreferencesMigration();

		const calls = stubs.mockUpdate.getCalls();
		const anthropicCall = calls.find(call => call.args[0] === 'models.preference.anthropic');
		const openaiCall = calls.find(call => call.args[0] === 'models.preference.openAI');

		assert.ok(!anthropicCall);
		assert.ok(openaiCall);
		assert.strictEqual(openaiCall.args[1], 'gpt-4');
	});
});

suite('Custom Models Migration Tests', () => {
	let stubs: MockStubs;

	setup(() => {
		stubs = setupMigrationTest([
			{
				source: {
					provider: {
						id: 'anthropic-api',
						displayName: 'Anthropic',
						settingName: 'anthropic'
					}
				}
			},
			{
				source: {
					provider: {
						id: 'openai-api',
						displayName: 'OpenAI',
						settingName: 'openAI'
					}
				}
			}
		]);
	});

	teardown(() => {
		sinon.restore();
	});

	test('migrates custom models from global object to individual settings', async () => {
		stubs.mockInspect.withArgs('models.custom').returns({
			globalValue: {
				'anthropic-api': [
					{ id: 'custom-claude', name: 'Custom Claude' }
				],
				'openai-api': [
					{ id: 'custom-gpt', name: 'Custom GPT' }
				]
			}
		});
		stubs.mockInspect.withArgs('models.custom.anthropic').returns({});
		stubs.mockInspect.withArgs('models.custom.openAI').returns({});

		await performCustomModelsMigration();

		const calls = stubs.mockUpdate.getCalls();
		const anthropicCall = calls.find(call => call.args[0] === 'models.custom.anthropic');
		const openaiCall = calls.find(call => call.args[0] === 'models.custom.openAI');
		const removeCall = calls.find(call => call.args[0] === 'models.custom');

		assert.ok(anthropicCall);
		assert.deepStrictEqual(anthropicCall.args[1], [{ id: 'custom-claude', name: 'Custom Claude' }]);
		assert.strictEqual(anthropicCall.args[2], vscode.ConfigurationTarget.Global);

		assert.ok(openaiCall);
		assert.deepStrictEqual(openaiCall.args[1], [{ id: 'custom-gpt', name: 'Custom GPT' }]);

		assert.ok(removeCall);
		assert.strictEqual(removeCall.args[1], undefined);
	});

	test('skips providers with empty custom model arrays', async () => {
		stubs.mockInspect.withArgs('models.custom').returns({
			globalValue: {
				'anthropic-api': [],
				'openai-api': [
					{ id: 'custom-gpt', name: 'Custom GPT' }
				]
			}
		});
		stubs.mockInspect.withArgs('models.custom.anthropic').returns({});
		stubs.mockInspect.withArgs('models.custom.openAI').returns({});

		await performCustomModelsMigration();

		const calls = stubs.mockUpdate.getCalls();
		const anthropicCall = calls.find(call => call.args[0] === 'models.custom.anthropic');
		const openaiCall = calls.find(call => call.args[0] === 'models.custom.openAI');

		assert.ok(!anthropicCall);
		assert.ok(openaiCall);
	});

	test('does not overwrite existing custom model settings', async () => {
		stubs.mockInspect.withArgs('models.custom').returns({
			globalValue: {
				'anthropic-api': [
					{ id: 'custom-claude', name: 'Custom Claude' }
				],
				'openai-api': [
					{ id: 'custom-gpt', name: 'Custom GPT' }
				]
			}
		});
		stubs.mockInspect.withArgs('models.custom.anthropic').returns({
			globalValue: [{ id: 'existing-model', name: 'Existing' }]
		});
		stubs.mockInspect.withArgs('models.custom.openAI').returns({});

		await performCustomModelsMigration();

		const calls = stubs.mockUpdate.getCalls();
		const anthropicCall = calls.find(call => call.args[0] === 'models.custom.anthropic');
		const openaiCall = calls.find(call => call.args[0] === 'models.custom.openAI');

		assert.ok(!anthropicCall);
		assert.ok(openaiCall);
	});
});

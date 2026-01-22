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
import { TEST_PROVIDERS } from './utils.js';

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
		stubs = setupMigrationTest(TEST_PROVIDERS);
	});

	teardown(() => {
		sinon.restore();
	});

	test('migrates from enabledProviders array to individual settings', async () => {
		stubs.mockInspect.withArgs('enabledProviders').returns({
			globalValue: ['anthropic-api', 'copilot-auth', 'azure']
		});

		await performProviderMigration();

		const calls = stubs.mockUpdate.getCalls();
		const anthropicCall = calls.find(call => call.args[0] === 'provider.anthropic.enable');
		const copilotCall = calls.find(call => call.args[0] === 'provider.githubCopilot.enable');
		const azureCall = calls.find(call => call.args[0] === 'provider.azure.enable');
		const removeCall = calls.find(call => call.args[0] === 'enabledProviders');

		assert.ok(anthropicCall);
		assert.strictEqual(anthropicCall.args[1], true);
		assert.strictEqual(anthropicCall.args[2], vscode.ConfigurationTarget.Global);

		assert.ok(copilotCall);
		assert.strictEqual(copilotCall.args[1], true);

		assert.ok(azureCall);
		assert.strictEqual(azureCall.args[1], true);

		assert.ok(removeCall);
		assert.strictEqual(removeCall.args[1], undefined);
	});

	test('overwrites existing individual settings (old value takes precedence)', async () => {
		stubs.mockInspect.withArgs('enabledProviders').returns({
			globalValue: ['anthropic-api', 'openai-api']
		});

		await performProviderMigration();

		const calls = stubs.mockUpdate.getCalls();
		const anthropicCall = calls.find(call => call.args[0] === 'provider.anthropic.enable');
		const openaiCall = calls.find(call => call.args[0] === 'provider.openAI.enable');

		// Old value takes precedence: anthropic should be overwritten to true
		assert.ok(anthropicCall);
		assert.strictEqual(anthropicCall.args[1], true);
		assert.ok(openaiCall);
		assert.strictEqual(openaiCall.args[1], true);
	});

	test('handles invalid provider IDs gracefully', async () => {
		stubs.mockInspect.withArgs('enabledProviders').returns({
			globalValue: ['invalid-provider-id', 'anthropic-api']
		});

		await performProviderMigration();

		const calls = stubs.mockUpdate.getCalls();
		const anthropicCall = calls.find(call => call.args[0] === 'provider.anthropic.enable');
		const removeCall = calls.find(call => call.args[0] === 'enabledProviders');
		const hasInvalidSetting = calls.some(call => call.args[0].includes('invalid'));

		assert.ok(anthropicCall);
		assert.ok(removeCall);
		assert.ok(!hasInvalidSetting);
	});

	test('does nothing when enabledProviders is not set', async () => {
		stubs.mockInspect.withArgs('enabledProviders').returns({});

		await performProviderMigration();

		const calls = stubs.mockUpdate.getCalls();
		assert.strictEqual(calls.length, 0);
	});

	test('does nothing when enabledProviders is empty array', async () => {
		stubs.mockInspect.withArgs('enabledProviders').returns({
			globalValue: []
		});

		await performProviderMigration();

		const calls = stubs.mockUpdate.getCalls();
		assert.strictEqual(calls.length, 0);
	});
});

suite('Model Preferences Migration Tests', () => {
	let stubs: MockStubs;

	setup(() => {
		stubs = setupMigrationTest(TEST_PROVIDERS);
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

	test('overwrites existing model preference settings (old value takes precedence)', async () => {
		stubs.mockInspect.withArgs('models.preference.byProvider').returns({
			globalValue: {
				'anthropic-api': 'claude-opus-4',
				'openai-api': 'gpt-4'
			}
		});

		await performModelPreferencesMigration();

		const calls = stubs.mockUpdate.getCalls();
		const anthropicCall = calls.find(call => call.args[0] === 'models.preference.anthropic');
		const openaiCall = calls.find(call => call.args[0] === 'models.preference.openAI');

		// Old value takes precedence: anthropic should be overwritten to claude-opus-4
		assert.ok(anthropicCall);
		assert.strictEqual(anthropicCall.args[1], 'claude-opus-4');
		assert.ok(openaiCall);
		assert.strictEqual(openaiCall.args[1], 'gpt-4');
	});

	test('does nothing when byProvider is not set', async () => {
		stubs.mockInspect.withArgs('models.preference.byProvider').returns({});

		await performModelPreferencesMigration();

		const calls = stubs.mockUpdate.getCalls();
		assert.strictEqual(calls.length, 0);
	});

	test('does nothing when byProvider is empty object', async () => {
		stubs.mockInspect.withArgs('models.preference.byProvider').returns({
			globalValue: {}
		});

		await performModelPreferencesMigration();

		const calls = stubs.mockUpdate.getCalls();
		assert.strictEqual(calls.length, 0);
	});
});

suite('Custom Models Migration Tests', () => {
	let stubs: MockStubs;

	setup(() => {
		stubs = setupMigrationTest(TEST_PROVIDERS);
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

		await performCustomModelsMigration();

		const calls = stubs.mockUpdate.getCalls();
		const anthropicCall = calls.find(call => call.args[0] === 'models.overrides.anthropic');
		const openaiCall = calls.find(call => call.args[0] === 'models.overrides.openAI');
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

		await performCustomModelsMigration();

		const calls = stubs.mockUpdate.getCalls();
		const anthropicCall = calls.find(call => call.args[0] === 'models.overrides.anthropic');
		const openaiCall = calls.find(call => call.args[0] === 'models.overrides.openAI');

		assert.ok(!anthropicCall);
		assert.ok(openaiCall);
		assert.deepStrictEqual(openaiCall.args[1], [{ id: 'custom-gpt', name: 'Custom GPT' }]);
	});

	test('overwrites existing custom model settings (old value takes precedence)', async () => {
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

		await performCustomModelsMigration();

		const calls = stubs.mockUpdate.getCalls();
		const anthropicCall = calls.find(call => call.args[0] === 'models.overrides.anthropic');
		const openaiCall = calls.find(call => call.args[0] === 'models.overrides.openAI');

		// Old value takes precedence: anthropic should be overwritten with the old value
		assert.ok(anthropicCall);
		assert.deepStrictEqual(anthropicCall.args[1], [{ id: 'custom-claude', name: 'Custom Claude' }]);
		assert.ok(openaiCall);
		assert.deepStrictEqual(openaiCall.args[1], [{ id: 'custom-gpt', name: 'Custom GPT' }]);
	});

	test('does nothing when models.custom is not set', async () => {
		stubs.mockInspect.withArgs('models.custom').returns({});

		await performCustomModelsMigration();

		const calls = stubs.mockUpdate.getCalls();
		assert.strictEqual(calls.length, 0);
	});

	test('does nothing when models.custom is empty object', async () => {
		stubs.mockInspect.withArgs('models.custom').returns({
			globalValue: {}
		});

		await performCustomModelsMigration();

		const calls = stubs.mockUpdate.getCalls();
		assert.strictEqual(calls.length, 0);
	});
});

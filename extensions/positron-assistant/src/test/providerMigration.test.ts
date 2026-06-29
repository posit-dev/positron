/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import {
	performProviderMigration,
	performModelPreferencesMigration,
	performCustomModelsMigration,
	performInlineCompletionsMigration
} from '../providerMigration.js';
import { stubGetModelProviders } from './utils.js';

interface MockStubs {
	mockInspect: sinon.SinonStub;
	mockUpdate: sinon.SinonStub;
	mockGet: sinon.SinonStub;
	mockShowInformationMessage: sinon.SinonStub;
}

function setupMigrationTest(): MockStubs {
	const mockInspect = sinon.stub();
	const mockUpdate = sinon.stub().resolves();
	const mockGet = sinon.stub().returns(false); // hideNotification defaults to false

	sinon.stub(vscode.workspace, 'getConfiguration').callsFake(() => ({
		inspect: mockInspect,
		update: mockUpdate,
		get: mockGet
	}) as unknown as vscode.WorkspaceConfiguration);

	const mockShowInformationMessage = sinon.stub(vscode.window, 'showInformationMessage').resolves();
	stubGetModelProviders();

	return { mockInspect, mockUpdate, mockGet, mockShowInformationMessage };
}

suite('Provider Migration Tests', () => {
	let stubs: MockStubs;

	setup(() => {
		stubs = setupMigrationTest();
	});

	teardown(() => {
		sinon.restore();
	});

	test('migrates from enabledProviders array to individual settings', async () => {
		stubs.mockInspect.withArgs('enabledProviders').returns({
			globalValue: ['anthropic-api', 'copilot-auth']
		});

		await performProviderMigration();

		const calls = stubs.mockUpdate.getCalls();
		const anthropicCall = calls.find(call => call.args[0] === 'provider.anthropic.enable');
		const copilotCall = calls.find(call => call.args[0] === 'provider.githubCopilot.enable');
		const removeCall = calls.find(call => call.args[0] === 'enabledProviders');

		assert.ok(anthropicCall);
		assert.strictEqual(anthropicCall.args[1], true);
		assert.strictEqual(anthropicCall.args[2], vscode.ConfigurationTarget.Global);

		assert.ok(copilotCall);
		assert.strictEqual(copilotCall.args[1], true);

		assert.ok(removeCall);
		assert.strictEqual(removeCall.args[1], undefined);
	});

	test('overwrites existing individual settings (old value takes precedence)', async () => {
		// Simulate existing new-style setting that will be overwritten
		stubs.mockInspect.withArgs('provider.anthropic.enable').returns({
			globalValue: false
		});
		stubs.mockInspect.withArgs('enabledProviders').returns({
			globalValue: ['anthropic-api']
		});

		await performProviderMigration();

		const calls = stubs.mockUpdate.getCalls();
		const anthropicCall = calls.find(call => call.args[0] === 'provider.anthropic.enable');

		// Old value takes precedence: anthropic should be overwritten from false to true
		assert.ok(anthropicCall);
		assert.strictEqual(anthropicCall.args[1], true);
	});

	test('skips invalid provider IDs and continues migration', async () => {
		stubs.mockInspect.withArgs('enabledProviders').returns({
			globalValue: ['invalid-provider-id', 'anthropic-api']
		});

		await performProviderMigration();

		const calls = stubs.mockUpdate.getCalls();
		const anthropicCall = calls.find(call => call.args[0] === 'provider.anthropic.enable');
		const removeCall = calls.find(call => call.args[0] === 'enabledProviders');
		const hasInvalidSetting = calls.some(call => call.args[0].includes('invalid'));

		// Valid provider should be migrated
		assert.ok(anthropicCall);
		// Old setting should be removed
		assert.ok(removeCall);
		// Invalid provider should not create a setting
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
		stubs = setupMigrationTest();
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

	test('skips invalid provider IDs in model preferences', async () => {
		stubs.mockInspect.withArgs('models.preference.byProvider').returns({
			globalValue: {
				'invalid-provider': 'some-model',
				'anthropic-api': 'claude-opus-4'
			}
		});

		await performModelPreferencesMigration();

		const calls = stubs.mockUpdate.getCalls();
		// Anthropic should be migrated, invalid provider should not
		const anthropicCall = calls.find(call => call.args[0] === 'models.preference.anthropic');
		const invalidCall = calls.find(call => call.args[0].includes('invalid'));

		assert.ok(anthropicCall);
		assert.ok(!invalidCall);
	});
});

suite('Custom Models Migration Tests', () => {
	let stubs: MockStubs;

	setup(() => {
		stubs = setupMigrationTest();
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

	test('skips invalid provider IDs in custom models', async () => {
		stubs.mockInspect.withArgs('models.custom').returns({
			globalValue: {
				'invalid-provider': [{ id: 'custom-model', name: 'Custom' }],
				'anthropic-api': [{ id: 'custom-claude', name: 'Custom Claude' }]
			}
		});

		await performCustomModelsMigration();

		const calls = stubs.mockUpdate.getCalls();
		// Anthropic should be migrated, invalid provider should not
		const anthropicCall = calls.find(call => call.args[0] === 'models.overrides.anthropic');
		const invalidCall = calls.find(call => call.args[0].includes('invalid'));

		assert.ok(anthropicCall);
		assert.ok(!invalidCall);
	});
});

suite('Inline Completions Migration Tests', () => {
	let stubs: MockStubs;

	setup(() => {
		stubs = setupMigrationTest();
	});

	teardown(() => {
		sinon.restore();
	});

	test('migrates inlineCompletions.enable to github.copilot.enable and removes old setting', async () => {
		stubs.mockInspect.withArgs('inlineCompletions.enable').returns({
			globalValue: { '*': false, 'r': true }
		});

		await performInlineCompletionsMigration();

		const calls = stubs.mockUpdate.getCalls();
		const writeCall = calls.find(call => call.args[0] === 'enable');
		const removeCall = calls.find(call => call.args[0] === 'inlineCompletions.enable');

		assert.ok(writeCall);
		assert.deepStrictEqual(writeCall.args[1], { '*': false, 'r': true });
		assert.strictEqual(writeCall.args[2], vscode.ConfigurationTarget.Global);

		assert.ok(removeCall);
		assert.strictEqual(removeCall.args[1], undefined);
	});

	test('merges over existing github.copilot.enable value (old value takes precedence)', async () => {
		stubs.mockInspect.withArgs('enable').returns({
			globalValue: { 'python': false, 'r': false }
		});
		stubs.mockInspect.withArgs('inlineCompletions.enable').returns({
			globalValue: { '*': false, 'r': true }
		});

		await performInlineCompletionsMigration();

		const writeCall = stubs.mockUpdate.getCalls().find(call => call.args[0] === 'enable');

		// Old value wins on the conflicting 'r' key; non-conflicting keys are preserved.
		assert.ok(writeCall);
		assert.deepStrictEqual(writeCall.args[1], { 'python': false, '*': false, 'r': true });
	});

	test('does nothing when inlineCompletions.enable is not set', async () => {
		stubs.mockInspect.withArgs('inlineCompletions.enable').returns({});

		await performInlineCompletionsMigration();

		assert.strictEqual(stubs.mockUpdate.getCalls().length, 0);
	});

	test('does nothing when inlineCompletions.enable is empty object', async () => {
		stubs.mockInspect.withArgs('inlineCompletions.enable').returns({
			globalValue: {}
		});

		await performInlineCompletionsMigration();

		assert.strictEqual(stubs.mockUpdate.getCalls().length, 0);
	});

	test('keeps old setting when the github.copilot.enable write fails', async () => {
		stubs.mockInspect.withArgs('inlineCompletions.enable').returns({
			globalValue: { '*': false }
		});
		stubs.mockUpdate.withArgs('enable').rejects(new Error('enforced by admin policy'));

		await performInlineCompletionsMigration();

		// The old setting must not be removed if the migration write failed.
		const removeCall = stubs.mockUpdate.getCalls().find(call => call.args[0] === 'inlineCompletions.enable');
		assert.ok(!removeCall);
	});
});

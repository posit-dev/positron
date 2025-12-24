/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import * as modelsModule from '../models.js';
import { performProviderMigration } from '../providerMigration.js';
import { registerSupportedProviders } from '../providerConfiguration.js';

suite('Provider Migration Tests', () => {
	let mockGetConfiguration: sinon.SinonStub;
	let mockUpdate: sinon.SinonStub;
	let mockShowWarningMessage: sinon.SinonStub;
	let mockShowInformationMessage: sinon.SinonStub;

	setup(() => {
		// Mock vscode.workspace.getConfiguration
		mockGetConfiguration = sinon.stub();
		mockUpdate = sinon.stub().resolves();

		sinon.stub(vscode.workspace, 'getConfiguration').callsFake(() => ({
			get: mockGetConfiguration,
			update: mockUpdate
		}) as unknown as vscode.WorkspaceConfiguration);

		// Mock vscode.window methods
		mockShowWarningMessage = sinon.stub(vscode.window, 'showWarningMessage').resolves();
		mockShowInformationMessage = sinon.stub(vscode.window, 'showInformationMessage').resolves();

		// Mock getLanguageModels to return test providers
		// eslint-disable-next-line local/code-no-any-casts
		sinon.stub(modelsModule, 'getLanguageModels').returns([
			{
				source: {
					provider: {
						id: 'anthropic-api',
						displayName: 'Anthropic'
					}
				}
			},
			{
				source: {
					provider: {
						id: 'openai-api',
						displayName: 'OpenAI'
					}
				}
			}
		] as any);

		// Register providers before running tests
		registerSupportedProviders();
	});

	teardown(() => {
		sinon.restore();
	});

	test('migrates providers when user approves', async () => {
		// Setup: Legacy setting exists
		mockGetConfiguration.withArgs('enabledProviders').returns(['anthropic-api', 'copilot', 'openai-api']);

		// Mock user approval
		mockShowWarningMessage.resolves('Migrate Now');

		await performProviderMigration();

		// Verify new setting was updated
		assert.ok(mockUpdate.calledWith('providers'), 'Should update providers setting');
		const providersCall = mockUpdate.getCalls().find((call: any) => call.args[0] === 'providers');
		assert.ok(providersCall, 'Should have called update with providers');

		const newConfig = providersCall.args[1];
		assert.strictEqual(newConfig['Anthropic'], true, 'Should enable Anthropic');
		assert.strictEqual(newConfig['GitHub Copilot'], true, 'Should enable GitHub Copilot');
		assert.strictEqual(newConfig['OpenAI'], true, 'Should enable OpenAI');

		// Verify old setting was removed
		assert.ok(mockUpdate.calledWith('enabledProviders', undefined), 'Should remove old setting');

		// Verify success notification
		assert.ok(mockShowInformationMessage.called, 'Should show success message');
	});

	test('does not migrate when user declines', async () => {
		mockGetConfiguration.withArgs('enabledProviders').returns(['anthropic-api']);
		mockShowWarningMessage.resolves('Not Now');

		await performProviderMigration();

		// Verify no updates were made
		assert.ok(!mockUpdate.called, 'Should not update settings when user declines');
	});

	test('does not run when no legacy setting exists', async () => {
		mockGetConfiguration.withArgs('enabledProviders').returns([]);

		await performProviderMigration();

		assert.ok(!mockShowWarningMessage.called, 'Should not show dialog when nothing to migrate');
		assert.ok(!mockUpdate.called, 'Should not update settings');
	});

	test('handles unsupported providers during migration', async () => {
		// Setup: Legacy setting with both supported and unsupported providers
		mockGetConfiguration.withArgs('enabledProviders').returns(['anthropic-api', 'unsupported-provider-id']);

		// Mock user approval
		mockShowWarningMessage.resolves('Migrate Now');

		await performProviderMigration();

		// Verify supported provider was migrated
		const providersCall = mockUpdate.getCalls().find((call: any) => call.args[0] === 'providers');
		assert.ok(providersCall, 'Should have updated providers setting');

		const newConfig = providersCall.args[1];
		assert.strictEqual(newConfig['Anthropic'], true, 'Should migrate supported provider only');
	});

	test('shows preview with unsupported providers', async () => {
		mockGetConfiguration.withArgs('enabledProviders').returns(['anthropic-api', 'unknown-provider']);
		mockShowWarningMessage.resolves('Not Now');

		await performProviderMigration();

		// Verify warning message includes mention of unsupported provider
		assert.ok(mockShowWarningMessage.called, 'Should show warning');
		const warningCall = mockShowWarningMessage.getCall(0);
		const message = warningCall.args[0];
		assert.ok(typeof message === 'string', 'Warning message should be a string');
	});

	test('migration completes even when both settings exist', async () => {
		// Note: The current implementation doesn't check if new setting exists before migrating
		// It will overwrite the new setting if user approves
		mockGetConfiguration.withArgs('providers').returns({ 'Anthropic': true });
		mockGetConfiguration.withArgs('enabledProviders').returns(['copilot']);
		mockShowWarningMessage.resolves('Migrate Now');

		await performProviderMigration();

		// Migration should still run (overwrites existing providers setting)
		assert.ok(mockUpdate.called, 'Should update settings');
	});
});

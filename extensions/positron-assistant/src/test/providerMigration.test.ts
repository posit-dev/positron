/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import * as providersModule from '../providers';
import { performProviderMigration } from '../providerMigration.js';

suite('Provider Migration Tests', () => {
	let mockGetConfiguration: sinon.SinonStub;
	let mockInspect: sinon.SinonStub;
	let mockGetValue: sinon.SinonStub;
	let mockUpdate: sinon.SinonStub;
	let mockShowInformationMessage: sinon.SinonStub;

	setup(() => {
		// Mock vscode.workspace.getConfiguration
		mockGetConfiguration = sinon.stub();
		mockInspect = sinon.stub();
		mockGetValue = sinon.stub();
		mockUpdate = sinon.stub().resolves();

		sinon.stub(vscode.workspace, 'getConfiguration').callsFake(() => ({
			get: mockGetConfiguration,
			getValue: mockGetValue,
			inspect: mockInspect,
			update: mockUpdate
		}) as unknown as vscode.WorkspaceConfiguration);

		// Mock vscode.window methods
		mockShowInformationMessage = sinon.stub(vscode.window, 'showInformationMessage').resolves();

		// Mock getModelProviders to return test providers
		// eslint-disable-next-line local/code-no-any-casts
		sinon.stub(providersModule, 'getModelProviders').returns([
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
			},
			{
				source: {
					provider: {
						id: 'echo',
						displayName: 'Echo',
						settingName: 'echo'
					}
				}
			}
		] as any);
	});

	teardown(() => {
		sinon.restore();
	});

	test('migrates from enabledProviders array to individual settings', async () => {
		// Setup: Legacy enabledProviders array exists in global scope
		mockInspect.withArgs('enabledProviders').returns({
			globalValue: ['anthropic-api', 'copilot-auth', 'echo'],
			workspaceValue: undefined
		});
		// Mock inspect for individual settings (not set yet)
		mockInspect.withArgs('provider.anthropic.enable').returns({});
		mockInspect.withArgs('provider.githubCopilot.enable').returns({});
		mockInspect.withArgs('provider.echo.enable').returns({});

		await performProviderMigration();

		// Verify individual settings were created
		const anthropicCall = mockUpdate.getCalls().find((call: any) => call.args[0] === 'provider.anthropic.enable');
		const copilotCall = mockUpdate.getCalls().find((call: any) => call.args[0] === 'provider.githubCopilot.enable');
		const echoCall = mockUpdate.getCalls().find((call: any) => call.args[0] === 'provider.echo.enable');

		assert.ok(anthropicCall, 'Should create anthropic setting');
		assert.strictEqual(anthropicCall.args[1], true, 'Should enable anthropic');
		assert.strictEqual(anthropicCall.args[2], vscode.ConfigurationTarget.Global);

		assert.ok(copilotCall, 'Should create copilot setting');
		assert.strictEqual(copilotCall.args[1], true, 'Should enable copilot');

		assert.ok(echoCall, 'Should create echo setting');
		assert.strictEqual(echoCall.args[1], true, 'Should enable echo');

		// Verify old setting was removed
		const removeEnableProvidersCall = mockUpdate.getCalls().find((call: any) => call.args[0] === 'enabledProviders');
		assert.ok(removeEnableProvidersCall, 'Should remove enabledProviders');
		assert.strictEqual(removeEnableProvidersCall.args[1], undefined);

		// Verify success notification
		assert.ok(mockShowInformationMessage.called, 'Should show success message');
	});


	test('does not overwrite existing individual settings', async () => {
		// Setup: Legacy setting exists, but user has already set some individual settings
		mockInspect.withArgs('enabledProviders').returns({
			globalValue: ['anthropic-api', 'openai-api'],
			workspaceValue: undefined
		});
		// Mock that anthropic is already set by user
		mockInspect.withArgs('provider.anthropic.enable').returns({
			globalValue: false // User explicitly disabled it
		});
		// openAI is not set
		mockInspect.withArgs('provider.openAI.enable').returns({});

		await performProviderMigration();

		// Verify anthropic was NOT overwritten
		const anthropicCall = mockUpdate.getCalls().find((call: any) => call.args[0] === 'provider.anthropic.enable');
		assert.ok(!anthropicCall, 'Should not overwrite existing anthropic setting');

		// Verify openAI was migrated
		const openaiCall = mockUpdate.getCalls().find((call: any) => call.args[0] === 'provider.openAI.enable');
		assert.ok(openaiCall, 'Should create openAI setting');
		assert.strictEqual(openaiCall.args[1], true);
	});

	test('migrates workspace settings to workspace scope', async () => {
		// Setup: Legacy setting in workspace scope
		mockInspect.withArgs('enabledProviders').returns({
			globalValue: undefined,
			workspaceValue: ['anthropic-api']
		});
		mockInspect.withArgs('provider.anthropic.enable').returns({});

		await performProviderMigration();

		// Verify individual setting created in workspace scope
		const anthropicCall = mockUpdate.getCalls().find((call: any) => call.args[0] === 'provider.anthropic.enable');
		assert.ok(anthropicCall);
		assert.strictEqual(anthropicCall.args[2], vscode.ConfigurationTarget.Workspace);

		// Verify old setting removed from workspace scope
		const removeCall = mockUpdate.getCalls().find((call: any) => call.args[0] === 'enabledProviders');
		assert.strictEqual(removeCall.args[2], vscode.ConfigurationTarget.Workspace);
	});

	test('prioritizes workspace over global when both exist', async () => {
		// Setup: Different settings in workspace and global
		mockInspect.withArgs('enabledProviders').returns({
			globalValue: ['anthropic-api'],
			workspaceValue: ['openai-api'] // Different
		});
		mockInspect.withArgs('provider.anthropic.enable').returns({});
		mockInspect.withArgs('provider.openAI.enable').returns({});

		await performProviderMigration();

		// Verify only workspace value was migrated
		const anthropicCall = mockUpdate.getCalls().find((call: any) => call.args[0] === 'provider.anthropic.enable');
		const openaiCall = mockUpdate.getCalls().find((call: any) => call.args[0] === 'provider.openAI.enable');

		assert.ok(!anthropicCall, 'Should not migrate global value when workspace exists');
		assert.ok(openaiCall, 'Should migrate workspace value');
		assert.strictEqual(openaiCall.args[2], vscode.ConfigurationTarget.Workspace);
	});

	test('does not run when no legacy settings exist or are empty', async () => {
		// Test both undefined and empty array scenarios
		mockInspect.withArgs('enabledProviders').returns({
			globalValue: undefined,
			workspaceValue: undefined
		});

		await performProviderMigration();

		assert.ok(!mockUpdate.called, 'Should not update any settings when undefined');
		assert.ok(!mockShowInformationMessage.called, 'Should not show notification when undefined');

		// Reset stubs for second scenario
		mockUpdate.resetHistory();
		mockShowInformationMessage.resetHistory();

		// Test empty array
		mockInspect.withArgs('enabledProviders').returns({
			globalValue: [],
			workspaceValue: undefined
		});

		await performProviderMigration();

		assert.ok(!mockUpdate.called, 'Should not update settings for empty arrays');
		assert.ok(!mockShowInformationMessage.called, 'Should not show notification for empty arrays');
	});

	suite('Error Handling', () => {
		test('handles invalid provider IDs gracefully', async () => {
			// Setup: Legacy setting with invalid provider ID
			mockInspect.withArgs('enabledProviders').returns({
				globalValue: ['invalid-provider-id', 'anthropic-api'],
				workspaceValue: undefined
			});
			mockInspect.withArgs('provider.anthropic.enable').returns({});

			await performProviderMigration();

			// Verify valid provider was migrated
			const anthropicCall = mockUpdate.getCalls().find((call: any) => call.args[0] === 'provider.anthropic.enable');
			assert.ok(anthropicCall, 'Should migrate valid provider');

			// Verify invalid provider was silently skipped (no error thrown)
			const allCalls = mockUpdate.getCalls().map((call: any) => call.args[0]);
			assert.ok(!allCalls.some((arg: string) => arg.includes('invalid')), 'Should skip invalid provider');
		});
	});
});

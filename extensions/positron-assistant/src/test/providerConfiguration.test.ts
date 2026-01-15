/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as positron from 'positron';
import * as sinon from 'sinon';
import * as providerMappingModule from '../providerMapping.js';
import {
	validateProviders,
	registerSupportedProviders,
	validateByProviderPreferences,
	validateProvidersEnabled
} from '../providerConfiguration.js';
import * as providersModule from '../providers';

suite('Provider Configuration Tests', () => {
	let mockGetConfiguration: sinon.SinonStub;
	let mockUpdate: sinon.SinonStub;
	let mockShowWarningMessage: sinon.SinonStub;

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

		// Mock getModelProviders to return test providers
		// eslint-disable-next-line local/code-no-any-casts
		sinon.stub(providersModule, 'getModelProviders').returns([
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

	suite('Core Functionality', () => {
		test('accepts display names and returns provider IDs', async () => {
			mockGetConfiguration.withArgs('providers').returns({
				'Anthropic': true,
				'OpenAI': true
			});
			mockGetConfiguration.withArgs('enabledProviders').returns([]);

			const result = await positron.ai.getEnabledProviders();

			assert.ok(result.includes('anthropic-api'), 'Should include anthropic-api');
			assert.ok(result.includes('openai-api'), 'Should include openai-api');
			assert.strictEqual(result.length, 2, 'Should return exactly 2 providers');
		});

		test('filters out disabled providers', async () => {
			mockGetConfiguration.withArgs('providers').returns({
				'Anthropic': true,
				'OpenAI': false
			});
			mockGetConfiguration.withArgs('enabledProviders').returns([]);

			const result = await positron.ai.getEnabledProviders();

			assert.ok(result.includes('anthropic-api'), 'Should include anthropic-api');
			assert.ok(!result.includes('openai-api'), 'Should not include openai-api');
			assert.strictEqual(result.length, 1, 'Should return exactly 1 provider');
		});

		test('accepts provider IDs in enabledProviders array', async () => {
			mockGetConfiguration.withArgs('providers').returns({});
			mockGetConfiguration.withArgs('enabledProviders').returns(['anthropic-api', 'openai-api']);

			const result = await positron.ai.getEnabledProviders();

			assert.ok(result.includes('anthropic-api'), 'Should include anthropic-api');
			assert.ok(result.includes('openai-api'), 'Should include openai-api');
			assert.strictEqual(result.length, 2, 'Should return exactly 2 providers');
		});

		test('returns empty array when no providers configured', async () => {
			mockGetConfiguration.withArgs('providers').returns({});
			mockGetConfiguration.withArgs('enabledProviders').returns([]);

			const result = await positron.ai.getEnabledProviders();

			assert.strictEqual(result.length, 0, 'Should return empty array');
			// Empty array signals "show all providers" to config dialog
		});
	});

	suite('Backwards Compatibility', () => {
		test('merges new and legacy settings', async () => {
			// New setting
			mockGetConfiguration.withArgs('providers').returns({
				'Anthropic': true
			});

			// Legacy setting
			mockGetConfiguration.withArgs('enabledProviders').returns(['copilot', 'openai-api']);

			const result = await positron.ai.getEnabledProviders();

			assert.ok(result.includes('anthropic-api'), 'Should include provider from new setting');
			assert.ok(result.includes('copilot'), 'Should include provider from legacy setting');
			assert.ok(result.includes('openai-api'), 'Should include provider from legacy setting');
			assert.strictEqual(result.length, 3, 'Should merge all providers');
		});

		test('deduplicates providers from both settings', async () => {
			// New setting
			mockGetConfiguration.withArgs('providers').returns({
				'Anthropic': true
			});

			// Legacy setting includes same provider via ID
			mockGetConfiguration.withArgs('enabledProviders').returns(['anthropic-api', 'openai-api']);

			const result = await positron.ai.getEnabledProviders();

			// Count occurrences of anthropic-api (should only appear once)
			const anthropicCount = result.filter(id => id === 'anthropic-api').length;
			assert.strictEqual(anthropicCount, 1, 'Should deduplicate anthropic-api');
			assert.ok(result.includes('openai-api'), 'Should include openai-api');
		});
	});

	suite('Validation', () => {
		test('warns about unsupported providers', () => {
			const identifiers = ['NonExistentProvider', 'Anthropic'];
			const result = validateProviders(identifiers, 'positron.assistant.providers', true);

			assert.ok(result.includes('anthropic-api'), 'Should include valid provider');
			assert.ok(!result.includes('NonExistentProvider'), 'Should exclude invalid provider');
			assert.strictEqual(result.length, 1, 'Should only return valid providers');

			// Verify user notification was shown
			assert.ok(mockShowWarningMessage.called, 'Should show warning message');
		});

		test('handles all invalid providers gracefully', () => {
			const identifiers = ['Invalid1', 'Invalid2'];
			const result = validateProviders(identifiers, 'positron.assistant.providers', false);

			assert.strictEqual(result.length, 0, 'Should return empty array');
		});

		test('can suppress user notification', () => {
			const identifiers = ['NonExistentProvider'];
			validateProviders(identifiers, 'positron.assistant.providers', false);

			assert.ok(!mockShowWarningMessage.called, 'Should not show message when suppressed');
		});

		test('validateByProviderPreferences validates display names', () => {
			mockGetConfiguration.withArgs('models.preference.byProvider').returns({
				'Anthropic': 'Claude Sonnet 4.5',
				'OpenAI': 'gpt-4o'
			});

			// Should not throw or show warnings for valid providers
			validateByProviderPreferences();
		});

		suite('validateProvidersEnabled', () => {
			let mockExecuteCommand: sinon.SinonStub;

			setup(() => {
				mockExecuteCommand = sinon.stub(vscode.commands, 'executeCommand').resolves();
			});

			teardown(() => {
				mockExecuteCommand.restore();
			});

			test('shows no warning when providers are enabled', async () => {
				mockGetConfiguration.withArgs('providers').returns({
					'Anthropic': true
				});
				mockGetConfiguration.withArgs('enabledProviders').returns([]);

				await validateProvidersEnabled();

				assert.ok(!mockShowWarningMessage.called, 'Should not show warning when providers are enabled');
				assert.ok(!mockExecuteCommand.called, 'Should not execute commands');
			});

			test('shows warning when no providers are enabled', async () => {
				mockGetConfiguration.withArgs('providers').returns({});
				mockGetConfiguration.withArgs('enabledProviders').returns([]);

				await validateProvidersEnabled();

				assert.ok(mockShowWarningMessage.called, 'Should show warning when no providers are enabled');
				const warningCall = mockShowWarningMessage.getCall(0);
				const message = warningCall.args[0];
				assert.ok(typeof message === 'string', 'Warning message should be a string');
				assert.ok(message.includes('No language model providers'), 'Message should mention no providers');
			});

			test('opens settings when user clicks "Open Settings"', async () => {
				mockGetConfiguration.withArgs('providers').returns({});
				mockGetConfiguration.withArgs('enabledProviders').returns([]);

				// Mock user clicking "Open Settings"
				mockShowWarningMessage.resolves('Open Settings');

				await validateProvidersEnabled();

				assert.ok(mockShowWarningMessage.called, 'Should show warning');
				assert.ok(mockExecuteCommand.called, 'Should execute command');
				assert.ok(
					mockExecuteCommand.calledWith('workbench.action.openSettings', 'positron.assistant.providers'),
					'Should open settings to the correct section'
				);
			});

			test('does not open settings when user dismisses warning', async () => {
				mockGetConfiguration.withArgs('providers').returns({});
				mockGetConfiguration.withArgs('enabledProviders').returns([]);

				// Mock user dismissing the warning (returns undefined)
				mockShowWarningMessage.resolves(undefined);

				await validateProvidersEnabled();

				assert.ok(mockShowWarningMessage.called, 'Should show warning');
				assert.ok(!mockExecuteCommand.called, 'Should not execute command when dismissed');
			});
		});

		test('registerSupportedProviders creates bidirectional mappings', () => {
			// Test display name to provider ID
			const providerId = providerMappingModule.uiNameToProviderId('Anthropic');
			assert.strictEqual(providerId, 'anthropic-api');

			// Test provider ID to display name
			const displayName = providerMappingModule.providerIdToUiName('anthropic-api');
			assert.strictEqual(displayName, 'Anthropic');
		});

		test('registers Copilot provider', () => {
			const providerId = providerMappingModule.uiNameToProviderId('GitHub Copilot');
			assert.strictEqual(providerId, 'copilot');

			const displayName = providerMappingModule.providerIdToUiName('copilot');
			assert.strictEqual(displayName, 'GitHub Copilot');
		});

		test('validateProviders works after registration', () => {
			// Should be able to validate providers
			const result = validateProviders(['Anthropic', 'copilot'], 'test', false);
			assert.strictEqual(result.length, 2);
			assert.ok(result.includes('anthropic-api'));
			assert.ok(result.includes('copilot'));
		});
	});
});

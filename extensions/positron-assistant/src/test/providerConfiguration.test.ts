/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as positron from 'positron';
import * as sinon from 'sinon';
import { PROVIDER_ENABLE_SETTINGS_SEARCH } from '../constants.js';
import {
	registerSupportedProviders,
	validateProvidersEnabled
} from '../providerConfiguration.js';
import * as providersModule from '../providers';

suite('Provider Configuration Tests', () => {
	let mockGetConfiguration: sinon.SinonStub;
	let mockUpdate: sinon.SinonStub;
	let mockShowWarningMessage: sinon.SinonStub;
	let mockGetEnabledProviders: sinon.SinonStub;

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

		// Mock positron.ai.getEnabledProviders
		mockGetEnabledProviders = sinon.stub(positron.ai, 'getEnabledProviders');

		// Mock positron.ai.registerProviderMetadata
		sinon.stub(positron.ai, 'registerProviderMetadata');

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
						id: 'openai-api',
						displayName: 'OpenAI',
						settingName: 'openAI'
					}
				}
			},
			{
				source: {
					provider: {
						id: 'copilot',
						displayName: 'GitHub Copilot',
						settingName: 'githubCopilot'
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

	suite('Validation', () => {
		suite('validateProvidersEnabled', () => {
			let mockExecuteCommand: sinon.SinonStub;

			setup(() => {
				mockExecuteCommand = sinon.stub(vscode.commands, 'executeCommand').resolves();
			});

			teardown(() => {
				mockExecuteCommand.restore();
			});

			test('shows no warning when providers are enabled', async () => {
				// Mock the Positron API to return enabled providers
				mockGetEnabledProviders.resolves(['anthropic-api']);

				await validateProvidersEnabled();

				assert.ok(!mockShowWarningMessage.called, 'Should not show warning when providers are enabled');
				assert.ok(!mockExecuteCommand.called, 'Should not execute commands');
			});

			test('shows warning when no providers are enabled', async () => {
				// Mock the Positron API to return no enabled providers
				mockGetEnabledProviders.resolves([]);

				await validateProvidersEnabled();

				assert.ok(mockShowWarningMessage.called, 'Should show warning when no providers are enabled');
				const warningCall = mockShowWarningMessage.getCall(0);
				const message = warningCall.args[0];
				assert.ok(typeof message === 'string', 'Warning message should be a string');
				assert.ok(message.includes('No language model providers'), 'Message should mention no providers');
			});

			test('opens settings when user clicks "Open Settings"', async () => {
				// Mock the Positron API to return no enabled providers
				mockGetEnabledProviders.resolves([]);

				// Mock user clicking "Open Settings"
				mockShowWarningMessage.resolves('Open Settings');

				await validateProvidersEnabled();

				assert.ok(mockShowWarningMessage.called, 'Should show warning');
				assert.ok(mockExecuteCommand.called, 'Should execute command');
				assert.ok(
					mockExecuteCommand.calledWith('workbench.action.openSettings', PROVIDER_ENABLE_SETTINGS_SEARCH),
					'Should open settings to the correct section'
				);
			});

			test('does not open settings when user dismisses warning', async () => {
				// Mock the Positron API to return no enabled providers
				mockGetEnabledProviders.resolves([]);

				// Mock user dismissing the warning (returns undefined)
				mockShowWarningMessage.resolves(undefined);

				await validateProvidersEnabled();

				assert.ok(mockShowWarningMessage.called, 'Should show warning');
				assert.ok(!mockExecuteCommand.called, 'Should not execute command when dismissed');
			});
		});
	});

	suite('Provider Settings Mapping', () => {
		test('all providers with settingName are properly defined', () => {
			// This test ensures that when a new provider is added, it has a valid settingName.
			// The developer must then:
			// 1. Add the setting to package.json (positron.assistant.provider.<settingName>.enable)
			// 2. Add the mapping to positronAssistantService.ts
			// Note: We don't validate package.json here - VS Code does that at extension load time.
			const providers = providersModule.getModelProviders();
			const providersWithSettingName = providers.filter(p => p.source.provider.settingName);

			for (const provider of providersWithSettingName) {
				const settingName = provider.source.provider.settingName;
				const providerId = provider.source.provider.id;

				assert.ok(settingName, `Provider ${providerId} should have a settingName defined`);
				assert.ok(settingName.length > 0, `Provider ${providerId} settingName should not be empty`);

				// Validate settingName format (should be camelCase)
				assert.match(
					settingName!,
					/^[a-z][a-zA-Z0-9]*$/,
					`Provider ${providerId} settingName should be camelCase: ${settingName}`
				);
			}

			// Ensure we have at least the main UI-visible providers
			const settingNames = providersWithSettingName.map(p => p.source.provider.settingName);
			assert.ok(settingNames.includes('anthropic'), 'Should have anthropic provider');
			assert.ok(settingNames.includes('githubCopilot'), 'Should have githubCopilot provider');
		});

		test('settingName to provider ID mapping is unique', () => {
			// Ensure no duplicate settingNames
			const providers = providersModule.getModelProviders();
			const settingNames = new Set<string>();
			const duplicates: string[] = [];

			for (const provider of providers) {
				const settingName = provider.source.provider.settingName;
				if (settingName) {
					if (settingNames.has(settingName)) {
						duplicates.push(settingName);
					}
					settingNames.add(settingName);
				}
			}

			assert.strictEqual(duplicates.length, 0, `Duplicate settingNames found: ${duplicates.join(', ')}`);
		});
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as positron from 'positron';
import * as sinon from 'sinon';
import { showConfigurationDialog } from '../config.js';
import * as providersModule from '../providers';
import * as completionModule from '../completion';
import { PROVIDER_ENABLE_SETTINGS_SEARCH } from '../constants.js';

suite('Configuration Dialog Tests', () => {
	let mockContext: vscode.ExtensionContext;
	let mockGetEnabledProviders: sinon.SinonStub;
	let mockShowLanguageModelConfig: sinon.SinonStub;
	let mockShowInformationMessage: sinon.SinonStub;
	let mockExecuteCommand: sinon.SinonStub;
	let mockOpenExternal: sinon.SinonStub;

	setup(() => {
		// Mock extension context
		mockContext = {
			globalState: {
				get: sinon.stub().returns([]),
				update: sinon.stub().resolves()
			},
			secrets: {
				get: sinon.stub().resolves(undefined),
				store: sinon.stub().resolves(),
				delete: sinon.stub().resolves()
			}
		} as unknown as vscode.ExtensionContext;

		// Mock positron.ai.getEnabledProviders
		mockGetEnabledProviders = sinon.stub(positron.ai, 'getEnabledProviders');

		// Mock positron.ai.showLanguageModelConfig
		mockShowLanguageModelConfig = sinon.stub(positron.ai, 'showLanguageModelConfig');

		// Mock vscode.window.showInformationMessage
		mockShowInformationMessage = sinon.stub(vscode.window, 'showInformationMessage');

		// Mock vscode.commands.executeCommand
		mockExecuteCommand = sinon.stub(vscode.commands, 'executeCommand').resolves();

		// Mock vscode.env.openExternal
		mockOpenExternal = sinon.stub(vscode.env, 'openExternal').resolves(true);

		// Mock provider modules
		sinon.stub(providersModule, 'getModelProviders').returns([
			{
				source: {
					provider: {
						id: 'anthropic-api',
						displayName: 'Anthropic',
						settingName: 'anthropic'
					},
					type: 'chat',
					defaults: {
						name: 'Claude',
						model: 'claude-sonnet-4-5'
					},
					supportedOptions: []
				}
			}
		] as any);

		sinon.stub(completionModule, 'completionModels').value([]);
	});

	teardown(() => {
		sinon.restore();
	});

	suite('Empty Provider Handling', () => {
		test('shows information message when no providers are enabled', async () => {
			// Mock no enabled providers
			mockGetEnabledProviders.resolves([]);

			await showConfigurationDialog(mockContext);

			assert.ok(mockShowInformationMessage.called, 'Should show information message');
			assert.ok(!mockShowLanguageModelConfig.called, 'Should not show configuration dialog');

			const messageCall = mockShowInformationMessage.getCall(0);
			const message = messageCall.args[0];
			assert.ok(typeof message === 'string', 'Message should be a string');
			assert.ok(message.includes('No language model providers are enabled'), 'Message should mention no providers');
		});

		test('opens settings when user clicks "Open Settings"', async () => {
			mockGetEnabledProviders.resolves([]);
			mockShowInformationMessage.resolves('Open Settings');

			await showConfigurationDialog(mockContext);

			assert.ok(mockExecuteCommand.called, 'Should execute command');
			assert.ok(
				mockExecuteCommand.calledWith('workbench.action.openSettings', PROVIDER_ENABLE_SETTINGS_SEARCH),
				'Should open settings to provider enable section'
			);
			assert.ok(!mockOpenExternal.called, 'Should not open external link');
		});

		test('opens documentation when user clicks "View Documentation"', async () => {
			mockGetEnabledProviders.resolves([]);
			mockShowInformationMessage.resolves('View Documentation');

			await showConfigurationDialog(mockContext);

			assert.ok(mockOpenExternal.called, 'Should open external link');
			const externalCall = mockOpenExternal.getCall(0);
			const uri = externalCall.args[0];
			assert.ok(uri.toString().includes('positron.posit.co'), 'Should link to Positron documentation');
			assert.ok(!mockExecuteCommand.calledWith('workbench.action.openSettings'), 'Should not open settings');
		});

		test('shows modal when at least one provider is enabled', async () => {
			mockGetEnabledProviders.resolves(['anthropic-api']);

			await showConfigurationDialog(mockContext);

			assert.ok(!mockShowInformationMessage.called, 'Should not show information message');
			assert.ok(mockShowLanguageModelConfig.called, 'Should show configuration dialog');
		});
	});
});

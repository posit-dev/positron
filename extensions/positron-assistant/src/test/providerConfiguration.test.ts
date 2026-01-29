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
import { stubGetModelProviders } from './utils.js';

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
		stubGetModelProviders();

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

});

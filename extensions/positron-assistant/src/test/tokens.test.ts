/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { TokenTracker } from '../tokens';
import { mock } from './utils';

suite('TokenTracker', () => {
	let mockContext: vscode.ExtensionContext;
	let mockWorkspaceState: vscode.Memento;
	let mockConfiguration: vscode.WorkspaceConfiguration;
	let executeCommandStub: sinon.SinonStub;
	let getConfigurationStub: sinon.SinonStub;
	let onDidChangeConfigurationStub: sinon.SinonStub;

	const ANTHROPIC_PROVIDER_ID = 'anthropic-api';
	const TEST_PROVIDER_ID = 'test-provider';
	const TOKEN_COUNT_KEY = 'positron.assistant.tokenCounts';

	setup(() => {
		// Mock workspace state
		mockWorkspaceState = mock<vscode.Memento>({
			get: sinon.stub() as any,
			update: sinon.stub().resolves()
		});

		// Mock extension context
		mockContext = mock<vscode.ExtensionContext>({
			workspaceState: mockWorkspaceState
		});

		// Mock workspace configuration
		mockConfiguration = mock<vscode.WorkspaceConfiguration>({
			get: sinon.stub() as any
		});

		// Mock VS Code APIs
		executeCommandStub = sinon.stub(vscode.commands, 'executeCommand').resolves();
		getConfigurationStub = sinon.stub(vscode.workspace, 'getConfiguration').returns(mockConfiguration);
		onDidChangeConfigurationStub = sinon.stub(vscode.workspace, 'onDidChangeConfiguration');

		// Set up default configuration behavior
		(mockConfiguration.get as sinon.SinonStub).withArgs('approximateTokenCount', [] as string[]).returns([]);
	});

	teardown(() => {
		sinon.restore();
	});

	suite('Constructor', () => {
		test('should initialize with empty token usage when no stored data', () => {
			(mockWorkspaceState.get as sinon.SinonStub).withArgs(TOKEN_COUNT_KEY).returns(undefined);

			const tracker = new TokenTracker(mockContext);

			// Should not set any context initially
			assert.strictEqual(executeCommandStub.callCount, 0);
		});

		test('should initialize with empty token usage when stored data is not a string', () => {
			(mockWorkspaceState.get as sinon.SinonStub).withArgs(TOKEN_COUNT_KEY).returns({ invalid: 'data' });

			const tracker = new TokenTracker(mockContext);

			// Should not set any context initially
			assert.strictEqual(executeCommandStub.callCount, 0);
		});

		test('should restore valid token usage from stored data', () => {
			const storedData = JSON.stringify([
				[ANTHROPIC_PROVIDER_ID, { inputTokens: 100, outputTokens: 50, cachedTokens: 20 }],
				[TEST_PROVIDER_ID, { inputTokens: 200, outputTokens: 75, cachedTokens: 20 }]
			]);
			(mockWorkspaceState.get as sinon.SinonStub).withArgs(TOKEN_COUNT_KEY).returns(storedData);

			const tracker = new TokenTracker(mockContext);

			// Should set context for both providers
			assert.strictEqual(executeCommandStub.callCount, 6);
			assert.ok(executeCommandStub.calledWith('setContext', `positron-assistant.${ANTHROPIC_PROVIDER_ID}.tokenCount.input`, 100));
			assert.ok(executeCommandStub.calledWith('setContext', `positron-assistant.${ANTHROPIC_PROVIDER_ID}.tokenCount.output`, 50));
			assert.ok(executeCommandStub.calledWith('setContext', `positron-assistant.${ANTHROPIC_PROVIDER_ID}.tokenCount.cached`, 20));
			assert.ok(executeCommandStub.calledWith('setContext', `positron-assistant.${TEST_PROVIDER_ID}.tokenCount.input`, 200));
			assert.ok(executeCommandStub.calledWith('setContext', `positron-assistant.${TEST_PROVIDER_ID}.tokenCount.output`, 75));
			assert.ok(executeCommandStub.calledWith('setContext', `positron-assistant.${TEST_PROVIDER_ID}.tokenCount.cached`, 20));
		});

		test('should filter out invalid entries from stored data', () => {
			const storedData = JSON.stringify([
				[ANTHROPIC_PROVIDER_ID, { inputTokens: 100, outputTokens: 50, cachedTokens: 20 }], // valid
				['invalid-entry'], // invalid - missing usage data
				[TEST_PROVIDER_ID, { inputTokens: 'not-a-number', outputTokens: 75, cachedTokens: 20 }], // invalid - input not a number
				['another-provider', { inputTokens: 200, outputTokens: 100, cachedTokens: 20 }] // valid
			]);
			(mockWorkspaceState.get as sinon.SinonStub).withArgs(TOKEN_COUNT_KEY).returns(storedData);

			const tracker = new TokenTracker(mockContext);

			// Should only set context for valid entries (2 providers * 3 context keys each)
			assert.strictEqual(executeCommandStub.callCount, 6);
			assert.ok(executeCommandStub.calledWith('setContext', `positron-assistant.${ANTHROPIC_PROVIDER_ID}.tokenCount.input`, 100));
			assert.ok(executeCommandStub.calledWith('setContext', `positron-assistant.${ANTHROPIC_PROVIDER_ID}.tokenCount.output`, 50));
			assert.ok(executeCommandStub.calledWith('setContext', `positron-assistant.${ANTHROPIC_PROVIDER_ID}.tokenCount.cached`, 20));
			assert.ok(executeCommandStub.calledWith('setContext', `positron-assistant.another-provider.tokenCount.input`, 200));
			assert.ok(executeCommandStub.calledWith('setContext', `positron-assistant.another-provider.tokenCount.output`, 100));
			assert.ok(executeCommandStub.calledWith('setContext', `positron-assistant.another-provider.tokenCount.cached`, 20));
		});

		test('should handle JSON parse errors gracefully', () => {
			(mockWorkspaceState.get as sinon.SinonStub).withArgs(TOKEN_COUNT_KEY).returns('invalid-json{');

			const tracker = new TokenTracker(mockContext);

			// Should not set any context when JSON parsing fails
			assert.strictEqual(executeCommandStub.callCount, 0);
		});

		test('should handle non-array parsed data gracefully', () => {
			const storedData = JSON.stringify({ not: 'an-array' });
			(mockWorkspaceState.get as sinon.SinonStub).withArgs(TOKEN_COUNT_KEY).returns(storedData);

			const tracker = new TokenTracker(mockContext);

			// Should not set any context when parsed data is not an array
			assert.strictEqual(executeCommandStub.callCount, 0);
		});

		test('should set up configuration change listener', () => {
			(mockWorkspaceState.get as sinon.SinonStub).withArgs(TOKEN_COUNT_KEY).returns(undefined);

			const tracker = new TokenTracker(mockContext);

			// Should register configuration change listener
			assert.strictEqual(onDidChangeConfigurationStub.callCount, 1);
		});
	});

	suite('Configuration Changes', () => {
		test('should update enabled providers when configuration changes', () => {
			(mockWorkspaceState.get as sinon.SinonStub).withArgs(TOKEN_COUNT_KEY).returns(undefined);
			let configurationListener: (event: vscode.ConfigurationChangeEvent) => void;
			onDidChangeConfigurationStub.callsFake((listener) => {
				configurationListener = listener;
				return mock<vscode.Disposable>({});
			});

			const tracker = new TokenTracker(mockContext);

			// Simulate configuration change
			const mockEvent = mock<vscode.ConfigurationChangeEvent>({
				affectsConfiguration: sinon.stub().withArgs('positron.assistant.approximateTokenCount').returns(true)
			});

			(mockConfiguration.get as sinon.SinonStub)
				.withArgs('approximateTokenCount', [] as string[])
				.returns([TEST_PROVIDER_ID]);

			configurationListener!(mockEvent);

			// Verify configuration was checked
			assert.ok(getConfigurationStub.calledWith('positron.assistant'));
			assert.ok((mockConfiguration.get as sinon.SinonStub).calledWith('approximateTokenCount', [] as string[]));
		});

		test('should clear tokens for disabled providers when configuration changes', () => {
			// Set up initial state with tokens for test provider
			const storedData = JSON.stringify([
				[TEST_PROVIDER_ID, { inputTokens: 100, outputTokens: 50, cachedTokens: 20 }]
			]);
			(mockWorkspaceState.get as sinon.SinonStub).withArgs(TOKEN_COUNT_KEY).returns(storedData);

			let configurationListener: (event: vscode.ConfigurationChangeEvent) => void;
			onDidChangeConfigurationStub.callsFake((listener) => {
				configurationListener = listener;
				return mock<vscode.Disposable>({});
			});

			const tracker = new TokenTracker(mockContext);

			// Reset call count after initialization
			executeCommandStub.resetHistory();
			(mockWorkspaceState.update as sinon.SinonStub).resetHistory();

			// Simulate configuration change that removes test provider
			const mockEvent = mock<vscode.ConfigurationChangeEvent>({
				affectsConfiguration: sinon.stub().withArgs('positron.assistant.approximateTokenCount').returns(true)
			});

			(mockConfiguration.get as sinon.SinonStub)
				.withArgs('approximateTokenCount', [] as string[])
				.returns([]); // Empty array - no providers enabled

			configurationListener!(mockEvent);

			// Should clear context for the disabled provider
			assert.ok(executeCommandStub.calledWith('setContext', `positron-assistant.${TEST_PROVIDER_ID}.tokenCount.input`, undefined));
			assert.ok(executeCommandStub.calledWith('setContext', `positron-assistant.${TEST_PROVIDER_ID}.tokenCount.output`, undefined));
			assert.ok(executeCommandStub.calledWith('setContext', `positron-assistant.${TEST_PROVIDER_ID}.tokenCount.cached`, undefined));

			// Should update workspace state
			assert.ok((mockWorkspaceState.update as sinon.SinonStub).calledWith(TOKEN_COUNT_KEY, sinon.match.string));
		});

		test('should not affect configuration when unrelated setting changes', () => {
			(mockWorkspaceState.get as sinon.SinonStub).withArgs(TOKEN_COUNT_KEY).returns(undefined);
			let configurationListener: (event: vscode.ConfigurationChangeEvent) => void;
			onDidChangeConfigurationStub.callsFake((listener) => {
				configurationListener = listener;
				return mock<vscode.Disposable>({});
			});

			const tracker = new TokenTracker(mockContext);

			// Reset call count after initialization
			getConfigurationStub.resetHistory();

			// Simulate configuration change for unrelated setting
			const mockEvent = mock<vscode.ConfigurationChangeEvent>({
				affectsConfiguration: sinon.stub().withArgs('positron.assistant.approximateTokenCount').returns(false)
			});

			configurationListener!(mockEvent);

			// Should not check configuration for unrelated changes
			assert.strictEqual(getConfigurationStub.callCount, 0);
		});
	});

	suite('addTokens', () => {
		test('should add tokens for enabled provider', () => {
			(mockWorkspaceState.get as sinon.SinonStub).withArgs(TOKEN_COUNT_KEY).returns(undefined);

			// First, set up the configuration to return the test provider as enabled
			(mockConfiguration.get as sinon.SinonStub)
				.withArgs('approximateTokenCount', [] as string[])
				.returns([TEST_PROVIDER_ID]);

			// Create the tracker which should read the configuration
			const tracker = new TokenTracker(mockContext);

			// Reset call count after initialization
			executeCommandStub.resetHistory();
			(mockWorkspaceState.update as sinon.SinonStub).resetHistory();

			// Now add tokens for the enabled provider
			tracker.addTokens(TEST_PROVIDER_ID, { inputTokens: 100, outputTokens: 50, cachedTokens: 20 });

			// Should set context for the provider
			assert.ok(executeCommandStub.calledWith('setContext', `positron-assistant.${TEST_PROVIDER_ID}.tokenCount.input`, 100));
			assert.ok(executeCommandStub.calledWith('setContext', `positron-assistant.${TEST_PROVIDER_ID}.tokenCount.output`, 50));
			assert.ok(executeCommandStub.calledWith('setContext', `positron-assistant.${TEST_PROVIDER_ID}.tokenCount.cached`, 20));

			// Should update workspace state
			const expectedData = JSON.stringify([[TEST_PROVIDER_ID, { inputTokens: 100, outputTokens: 50, cachedTokens: 20 }]]);
			assert.ok((mockWorkspaceState.update as sinon.SinonStub).calledWith(TOKEN_COUNT_KEY, expectedData));
		});

		test('should accumulate tokens for multiple calls', () => {
			(mockWorkspaceState.get as sinon.SinonStub).withArgs(TOKEN_COUNT_KEY).returns(undefined);

			// Set up the configuration to return the test provider as enabled
			(mockConfiguration.get as sinon.SinonStub)
				.withArgs('approximateTokenCount', [] as string[])
				.returns([TEST_PROVIDER_ID]);

			const tracker = new TokenTracker(mockContext);

			// Reset call count after initialization
			executeCommandStub.resetHistory();

			tracker.addTokens(TEST_PROVIDER_ID, { inputTokens: 100, outputTokens: 50, cachedTokens: 0 });
			tracker.addTokens(TEST_PROVIDER_ID, { inputTokens: 25, outputTokens: 25, cachedTokens: 100 });

			// Should set context with accumulated values
			assert.ok(executeCommandStub.calledWith('setContext', `positron-assistant.${TEST_PROVIDER_ID}.tokenCount.input`, 125));
			assert.ok(executeCommandStub.calledWith('setContext', `positron-assistant.${TEST_PROVIDER_ID}.tokenCount.output`, 75));
			assert.ok(executeCommandStub.calledWith('setContext', `positron-assistant.${TEST_PROVIDER_ID}.tokenCount.cached`, 100));
		});

		test('should skip adding tokens for disabled provider', () => {
			(mockWorkspaceState.get as sinon.SinonStub).withArgs(TOKEN_COUNT_KEY).returns(undefined);
			(mockConfiguration.get as sinon.SinonStub)
				.withArgs('approximateTokenCount', [] as string[])
				.returns([]); // No additional providers enabled

			const tracker = new TokenTracker(mockContext);

			// Reset call count after initialization
			executeCommandStub.resetHistory();
			(mockWorkspaceState.update as sinon.SinonStub).resetHistory();

			tracker.addTokens(TEST_PROVIDER_ID, { inputTokens: 100, outputTokens: 50, cachedTokens: 0 });

			// Should not set context or update state for disabled provider
			assert.strictEqual(executeCommandStub.callCount, 0);
			assert.strictEqual((mockWorkspaceState.update as sinon.SinonStub).callCount, 0);
		});

		test('should always allow Anthropic provider (default enabled)', () => {
			(mockWorkspaceState.get as sinon.SinonStub).withArgs(TOKEN_COUNT_KEY).returns(undefined);
			(mockConfiguration.get as sinon.SinonStub)
				.withArgs('approximateTokenCount', [] as string[])
				.returns([]); // No additional providers enabled

			const tracker = new TokenTracker(mockContext);

			// Reset call count after initialization
			executeCommandStub.resetHistory();
			(mockWorkspaceState.update as sinon.SinonStub).resetHistory();

			tracker.addTokens(ANTHROPIC_PROVIDER_ID, { inputTokens: 100, outputTokens: 50, cachedTokens: 20 });

			// Should set context for Anthropic provider even when not in config
			assert.ok(executeCommandStub.calledWith('setContext', `positron-assistant.${ANTHROPIC_PROVIDER_ID}.tokenCount.input`, 100));
			assert.ok(executeCommandStub.calledWith('setContext', `positron-assistant.${ANTHROPIC_PROVIDER_ID}.tokenCount.output`, 50));
			assert.ok(executeCommandStub.calledWith('setContext', `positron-assistant.${ANTHROPIC_PROVIDER_ID}.tokenCount.cached`, 20));

			// Should update workspace state
			const expectedData = JSON.stringify([[ANTHROPIC_PROVIDER_ID, { inputTokens: 100, outputTokens: 50, cachedTokens: 20 }]]);
			assert.ok((mockWorkspaceState.update as sinon.SinonStub).calledWith(TOKEN_COUNT_KEY, expectedData));
		});
	});

	suite('clearTokens', () => {
		test('should clear tokens for existing provider', () => {
			const storedData = JSON.stringify([
				[TEST_PROVIDER_ID, { inputTokens: 100, outputTokens: 50, cachedTokens: 20 }]
			]);
			(mockWorkspaceState.get as sinon.SinonStub).withArgs(TOKEN_COUNT_KEY).returns(storedData);

			const tracker = new TokenTracker(mockContext);

			// Reset call count after initialization
			executeCommandStub.resetHistory();
			(mockWorkspaceState.update as sinon.SinonStub).resetHistory();

			tracker.clearTokens(TEST_PROVIDER_ID);

			// Should delete context for the provider
			assert.ok(executeCommandStub.calledWith('setContext', `positron-assistant.${TEST_PROVIDER_ID}.tokenCount.input`, undefined));
			assert.ok(executeCommandStub.calledWith('setContext', `positron-assistant.${TEST_PROVIDER_ID}.tokenCount.output`, undefined));
			assert.ok(executeCommandStub.calledWith('setContext', `positron-assistant.${TEST_PROVIDER_ID}.tokenCount.cached`, undefined));

			// Should update workspace state with empty data
			const expectedData = JSON.stringify([]);
			assert.ok((mockWorkspaceState.update as sinon.SinonStub).calledWith(TOKEN_COUNT_KEY, expectedData));
		});

		test('should handle clearing tokens for non-existent provider', () => {
			(mockWorkspaceState.get as sinon.SinonStub).withArgs(TOKEN_COUNT_KEY).returns(undefined);

			const tracker = new TokenTracker(mockContext);

			// Reset call count after initialization
			executeCommandStub.resetHistory();
			(mockWorkspaceState.update as sinon.SinonStub).resetHistory();

			tracker.clearTokens(TEST_PROVIDER_ID);

			// Should not call any methods for non-existent provider
			assert.strictEqual(executeCommandStub.callCount, 0);
			assert.strictEqual((mockWorkspaceState.update as sinon.SinonStub).callCount, 0);
		});

		test('should preserve other providers when clearing one', () => {
			const storedData = JSON.stringify([
				[TEST_PROVIDER_ID, { inputTokens: 100, outputTokens: 50, cachedTokens: 20 }],
				[ANTHROPIC_PROVIDER_ID, { inputTokens: 200, outputTokens: 75, cachedTokens: 20 }]
			]);
			(mockWorkspaceState.get as sinon.SinonStub).withArgs(TOKEN_COUNT_KEY).returns(storedData);

			const tracker = new TokenTracker(mockContext);

			// Reset call count after initialization
			executeCommandStub.resetHistory();
			(mockWorkspaceState.update as sinon.SinonStub).resetHistory();

			tracker.clearTokens(TEST_PROVIDER_ID);

			// Should delete context for the cleared provider
			assert.ok(executeCommandStub.calledWith('setContext', `positron-assistant.${TEST_PROVIDER_ID}.tokenCount.input`, undefined));
			assert.ok(executeCommandStub.calledWith('setContext', `positron-assistant.${TEST_PROVIDER_ID}.tokenCount.output`, undefined));
			assert.ok(executeCommandStub.calledWith('setContext', `positron-assistant.${TEST_PROVIDER_ID}.tokenCount.cached`, undefined));

			// Should update workspace state with remaining provider
			const expectedData = JSON.stringify([[ANTHROPIC_PROVIDER_ID, { inputTokens: 200, outputTokens: 75, cachedTokens: 20 }]]);
			assert.ok((mockWorkspaceState.update as sinon.SinonStub).calledWith(TOKEN_COUNT_KEY, expectedData));
		});
	});

	suite('Integration Tests', () => {
		test('should handle complete workflow: init -> add -> clear', () => {
			(mockWorkspaceState.get as sinon.SinonStub).withArgs(TOKEN_COUNT_KEY).returns(undefined);
			(mockConfiguration.get as sinon.SinonStub)
				.withArgs('approximateTokenCount', [] as string[])
				.returns([TEST_PROVIDER_ID]);

			const tracker = new TokenTracker(mockContext);

			// Add tokens
			tracker.addTokens(TEST_PROVIDER_ID, { inputTokens: 100, outputTokens: 50, cachedTokens: 0 });
			tracker.addTokens(TEST_PROVIDER_ID, { inputTokens: 25, outputTokens: 10, cachedTokens: 100 });

			// Clear tokens
			tracker.clearTokens(TEST_PROVIDER_ID);

			// Final state should have no tokens
			const updateCalls = (mockWorkspaceState.update as sinon.SinonStub).getCalls();
			const lastCall = updateCalls[updateCalls.length - 1];
			assert.ok(lastCall, 'Expected at least one call to update');
			assert.strictEqual(lastCall.args[1], JSON.stringify([]));
		});

		test('should handle multiple providers independently', () => {
			(mockWorkspaceState.get as sinon.SinonStub).withArgs(TOKEN_COUNT_KEY).returns(undefined);
			(mockConfiguration.get as sinon.SinonStub)
				.withArgs('approximateTokenCount', [] as string[])
				.returns([TEST_PROVIDER_ID, 'another-provider']);

			const tracker = new TokenTracker(mockContext);

			// Add tokens for both providers
			tracker.addTokens(TEST_PROVIDER_ID, { inputTokens: 100, outputTokens: 50, cachedTokens: 0 });
			tracker.addTokens('another-provider', { inputTokens: 200, outputTokens: 75, cachedTokens: 0 });

			// Clear only one provider
			tracker.clearTokens(TEST_PROVIDER_ID);

			// Should only have the other provider remaining
			const updateCalls = (mockWorkspaceState.update as sinon.SinonStub).getCalls();
			const lastCall = updateCalls[updateCalls.length - 1];
			assert.ok(lastCall, 'Expected at least one call to update');
			const finalData = JSON.parse(lastCall.args[1]);
			assert.strictEqual(finalData.length, 1);
			assert.deepStrictEqual(finalData[0], ['another-provider', { inputTokens: 200, outputTokens: 75, cachedTokens: 0 }]);
		});
	});
});

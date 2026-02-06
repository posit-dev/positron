/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { assertNoRpcFromEntry } from '../../utils.js';
import assert from 'assert';

suite('positron API - ai', () => {

	suiteSetup(async () => {
		await vscode.extensions.getExtension('vscode.vscode-api-tests')?.activate();
	});

	teardown(async function () {
		assertNoRpcFromEntry([positron, 'positron']);
	});

	test('getCurrentPlotUri returns expected type', async () => {
		const plotUri = await positron.ai.getCurrentPlotUri();
		assert.ok(plotUri === undefined || typeof plotUri === 'string',
			'Plot URI should be either undefined or a string');
	});

	test('registerChatAgent handles valid agent data', async () => {
		const agentData: positron.ai.ChatAgentData = {
			id: 'test.agent',
			name: 'Test Agent',
			fullName: 'Test Chat Agent',
			description: 'A test chat agent',
			isDefault: false,
			metadata: {
				isSticky: true
			},
			modes: [
				positron.PositronChatMode.Ask,
				positron.PositronChatMode.Edit,
			],
			slashCommands: [
				{
					name: 'test',
					description: 'Run a test command',
					isSticky: true
				}
			],
			locations: [positron.PositronChatAgentLocation.Panel],
			disambiguation: [
				{
					category: 'test',
					description: 'Test category',
					examples: ['example 1', 'example 2']
				}
			]
		};

		const disposable = await positron.ai.registerChatAgent(agentData);
		assert.ok(disposable, 'Should return a valid disposable');
		disposable.dispose();
	});

	test('getPositronChatContext returns valid context for request', async () => {
		// Create a proper ChatRequest with required properties
		// Using 'any' to bypass type checking as we're only testing getPositronChatContext
		// which only uses the location property from the request
		const request: Partial<vscode.ChatRequest> = {
			prompt: 'test request',
			command: 'ask',
			references: [],
			location: vscode.ChatLocation.Panel,
			model: {
				id: 'test-model',
				name: 'Test Model',
				vendor: 'test',
				family: 'test-family',
				version: '1.0.0',
				capabilities: {
					supportsImageToText: false,
					supportsToolCalling: false
				},
				maxInputTokens: 2000,
				sendRequest: async () => ({
					stream: (async function* () { yield ''; })(),
					text: (async function* () { yield ''; })()
				}),
				countTokens: async () => 0
			}
		};

		const context = await positron.ai.getPositronChatContext(request as vscode.ChatRequest);

		assert.ok(context, 'Context should be returned');
		// See IPositronChatContext for expected properties
		assert.ok('currentDate' in context || 'positronVersion' in context,
			'Context should have expected structure');
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as positron from 'positron';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { AnthropicLanguageModel } from '../anthropic';
import { ModelConfig } from '../config';
import { EMPTY_TOOL_RESULT_PLACEHOLDER } from '../utils.js';

suite('AnthropicLanguageModel', () => {
	let model: AnthropicLanguageModel;
	let mockClient: any;
	let mockProgress: vscode.Progress<vscode.ChatResponseFragment2>;
	let mockCancellationToken: vscode.CancellationToken;

	setup(() => {
		// Create a mock Anthropic client
		mockClient = {
			messages: {
				stream: sinon.stub().returns({
					on: sinon.stub(),
					abort: sinon.stub(),
					done: sinon.stub().resolves()
				})
			}
		};

		// Create a mock configuration
		const config: ModelConfig = {
			id: 'test-model',
			name: 'Test Model',
			provider: 'anthropic',
			model: 'claude-test',
			apiKey: 'test-api-key', // pragma: allowlist secret
			type: positron.PositronLanguageModelType.Chat
		};

		// Create an instance of the AnthropicLanguageModel
		model = new AnthropicLanguageModel(config);

		// Replace the client with our mock
		(model as any)._client = mockClient;

		// Create mock progress
		mockProgress = {
			report: sinon.stub()
		};

		// Create a cancellation token
		const cancellationTokenSource = new vscode.CancellationTokenSource();
		mockCancellationToken = cancellationTokenSource.token;
	});

	teardown(() => {
		sinon.restore();
	});

	/**
	 * Test the filtering behavior by checking the messages passed to Anthropic
	 * when a message with empty LanguageModelTextPart content is included.
	 */
	test('provideLanguageModelResponse filters empty messages and different LanguageModelTextPart contents correctly', async () => {
		// Create test messages with different combinations of empty/non-empty content
		const emptyTextPart = new vscode.LanguageModelTextPart('');
		const whitespaceTextPart = new vscode.LanguageModelTextPart('   \n  ');
		const nonEmptyTextPart = new vscode.LanguageModelTextPart('Hello');

		// Define test messages with different combinations
		const messagesWithVariousContent = [
			// Message with no content - should be filtered out
			{
				message: vscode.LanguageModelChatMessage.User([]),
				keep: false
			},
			// Message with only empty text content - should be filtered out
			{
				message: vscode.LanguageModelChatMessage.User([emptyTextPart]),
				keep: false
			},
			// Message with only whitespace - should be filtered out
			{
				message: vscode.LanguageModelChatMessage.User([whitespaceTextPart]),
				keep: false
			},
			// Message with non-empty text content - should be kept
			{
				message: vscode.LanguageModelChatMessage.User([nonEmptyTextPart]),
				keep: true
			},
			// Message with both empty and non-empty text content - should be kept
			{
				message: vscode.LanguageModelChatMessage.Assistant([emptyTextPart, nonEmptyTextPart]),
				keep: true
			},
		];

		const messages = messagesWithVariousContent.map(m => m.message);
		const numOfMessagesToKeep = messagesWithVariousContent.filter(m => m.keep).length;

		// Call the method under test
		await model.provideLanguageModelResponse(
			messages,
			{},
			'test-extension',
			mockProgress,
			mockCancellationToken
		);

		// Check that messages were filtered correctly
		const streamCall = mockClient.messages.stream.getCall(0);
		assert.ok(streamCall, 'Stream method was not called');

		const messagesPassedToAnthropicClient = streamCall.args[0].messages;
		assert.strictEqual(messagesPassedToAnthropicClient.length, numOfMessagesToKeep, 'Only non-empty messages should be passed to the Anthropic client');

		// Verify specific message patterns that should be included vs filtered
		const hasMessageWithNonEmptyContent = messagesPassedToAnthropicClient.some((msg: any) =>
			msg.content.some((content: any) => content.type === 'text' && content.text === 'Hello')
		);
		assert.strictEqual(hasMessageWithNonEmptyContent, true, 'Messages with non-empty content should be included');
	});

	test('provideLanguageModelResponse processes LanguageModelToolCallPart and LanguageModelToolResultPart contents correctly', async () => {
		// 1st tool call with empty result
		const toolCallId1 = 'test-tool-callId-1';
		const toolCallEmptyPart = new vscode.LanguageModelToolCallPart(toolCallId1, `${toolCallId1}-tool`, {});
		const emptyToolResultPartOriginal = new vscode.LanguageModelToolResultPart(toolCallId1, []);
		const emptyToolResultPartExpected = new vscode.LanguageModelToolResultPart(toolCallId1, [
			new vscode.LanguageModelTextPart(EMPTY_TOOL_RESULT_PLACEHOLDER),
		]);

		// 2nd tool call with non-empty result
		const toolCallId2 = 'test-tool-callId-2';
		const toolCallNonEmptyPart = new vscode.LanguageModelToolCallPart(toolCallId2, `${toolCallId2}-tool`, {});
		const nonEmptyToolResultPart = new vscode.LanguageModelToolResultPart(toolCallId2, [
			new vscode.LanguageModelTextPart('This is a non-empty tool result'),
		]);

		const messagesWithToolContent = [
			// Tool call - should be passed
			{
				message: vscode.LanguageModelChatMessage.Assistant([toolCallEmptyPart]),
			},
			// Tool result with empty content - should be passed, but replaced with a placeholder
			{
				message: vscode.LanguageModelChatMessage.User([emptyToolResultPartOriginal]),
				expectedText: EMPTY_TOOL_RESULT_PLACEHOLDER
			},
			// Tool call - should be passed
			{
				message: vscode.LanguageModelChatMessage.Assistant([toolCallNonEmptyPart]),
			},
			// Tool result with non-empty content - should be passed as is
			{
				message: vscode.LanguageModelChatMessage.User([nonEmptyToolResultPart]),
			},
		];

		const messages = messagesWithToolContent.map(m => m.message);
		const numOfMessagesToKeep = messagesWithToolContent.length;

		// Call the method under test
		await model.provideLanguageModelResponse(
			messages,
			{},
			'test-extension',
			mockProgress,
			mockCancellationToken
		);

		// Check that messages were processed correctly
		const streamCall = mockClient.messages.stream.getCall(0);
		assert.ok(streamCall, 'Stream method was not called');

		const messagesPassedToAnthropicClient = streamCall.args[0].messages;
		assert.strictEqual(messagesPassedToAnthropicClient.length, numOfMessagesToKeep, 'All messages should be passed to the Anthropic client');

		messagesWithToolContent.forEach((msg, index) => {
			const expectedText = msg.expectedText;
			if (!expectedText) {
				return;
			}
			// sample actualContent: [{"type":"tool_result","tool_use_id":"test-tool-callId-1","content":[{"type":"text","text":"tool result is empty"}]}]
			const actualText = messagesPassedToAnthropicClient[index].content[0].content[0].text;
			assert.deepStrictEqual(actualText, expectedText, `Message text at index ${index} should match the expected text`);
		});
	});
});

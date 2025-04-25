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

		// Create mock progress and cancellation token
		mockProgress = {
			report: sinon.stub()
		};

		mockCancellationToken = {
			isCancellationRequested: false,
			onCancellationRequested: sinon.stub()
		};
	});

	teardown(() => {
		sinon.restore();
	});

	test('provideLanguageModelResponse should filter out messages with empty text content', async () => {
		// Create test messages
		const emptyTextPart = new vscode.LanguageModelTextPart('');
		const nonEmptyTextPart = new vscode.LanguageModelTextPart('Hello');

		const messagesWithEmpty = [
			// Message with only empty text content
			vscode.LanguageModelChatMessage.User([emptyTextPart]),
			// Message with non-empty text content
			vscode.LanguageModelChatMessage.User([nonEmptyTextPart]),
			// Message with both empty and non-empty text content
			vscode.LanguageModelChatMessage.Assistant([emptyTextPart, nonEmptyTextPart])
		];

		// Call the method under test
		await model.provideLanguageModelResponse(
			messagesWithEmpty,
			{},
			'test-extension',
			mockProgress,
			mockCancellationToken
		);

		// Check that messages were filtered before being passed to the Anthropic client
		const streamCall = mockClient.messages.stream.getCall(0);
		assert.ok(streamCall, 'Stream method was not called');

		// The empty message should be filtered out
		const messagesPassedToAnthropicClient = streamCall.args[0].messages;
		assert.strictEqual(messagesPassedToAnthropicClient.length, 2, 'Only non-empty messages should be passed to the Anthropic client');

		// Verify that the message with only empty content was filtered out
		const hasEmptyMessage = messagesPassedToAnthropicClient.some((msg: any) => {
			return msg.content.length === 0 ||
				(msg.content.length === 1 &&
					msg.content[0].type === 'text' &&
					msg.content[0].text === '');
		});
		assert.strictEqual(hasEmptyMessage, false, 'Messages with only empty content should be filtered out');
	});

	/**
	 * Test the filtering behavior by checking the messages passed to Anthropic
	 * when a message with empty content is included.
	 */
	test('provideLanguageModelResponse filters empty messages correctly with different content mixes', async () => {
		// Create test messages with different combinations of empty/non-empty content
		const emptyTextPart = new vscode.LanguageModelTextPart('');
		const whitespaceTextPart = new vscode.LanguageModelTextPart('   \n  ');
		const nonEmptyTextPart = new vscode.LanguageModelTextPart('Hello');

		const messagesWithVariousContent = [
			// Message with only empty text content - should be filtered out
			new vscode.LanguageModelChatMessage(vscode.LanguageModelChatMessageRole.User, [emptyTextPart]),
			// Message with only whitespace - should be filtered out
			new vscode.LanguageModelChatMessage(vscode.LanguageModelChatMessageRole.User, [whitespaceTextPart]),
			// Message with non-empty text content - should be kept
			new vscode.LanguageModelChatMessage(vscode.LanguageModelChatMessageRole.User, [nonEmptyTextPart]),
			// Message with both empty and non-empty text content - should be kept
			new vscode.LanguageModelChatMessage(vscode.LanguageModelChatMessageRole.Assistant, [emptyTextPart, nonEmptyTextPart])
		];

		// Call the method under test
		await model.provideLanguageModelResponse(
			messagesWithVariousContent,
			{},
			'test-extension',
			mockProgress,
			mockCancellationToken
		);

		// Check that messages were filtered correctly
		const streamCall = mockClient.messages.stream.getCall(0);
		assert.ok(streamCall, 'Stream method was not called');

		const messagesPassedToAnthropicClient = streamCall.args[0].messages;
		assert.strictEqual(messagesPassedToAnthropicClient.length, 2, 'Only non-empty messages should be passed to the Anthropic client');

		// Verify specific message patterns that should be included vs filtered
		const hasMessageWithNonEmptyContent = messagesPassedToAnthropicClient.some((msg: any) =>
			msg.content.some((content: any) => content.type === 'text' && content.text === 'Hello')
		);
		assert.strictEqual(hasMessageWithNonEmptyContent, true, 'Messages with non-empty content should be included');
	});
});

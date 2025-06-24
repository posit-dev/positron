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

type ChatMessageValidateInfo = {
	testName: string;
	message: vscode.LanguageModelChatMessage2;
	validate: (content: any[]) => void;
};

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
					done: sinon.stub().resolves(),
					finalMessage: sinon.stub().resolves({}),
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
		const nonEmptyText = 'Hello';
		const emptyTextPart = new vscode.LanguageModelTextPart('');
		const whitespaceTextPart = new vscode.LanguageModelTextPart('   \n  ');
		const nonEmptyTextPart = new vscode.LanguageModelTextPart(nonEmptyText);

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

		// We expect two messages with non-empty content to be passed to the Anthropic client
		const messagesPassedToAnthropicClient = streamCall.args[0].messages;
		assert.strictEqual(messagesPassedToAnthropicClient.length, numOfMessagesToKeep, 'Only non-empty messages should be passed to the Anthropic client');

		// Verify each passed message has the non-empty content we expect
		const hasMessageWithNonEmptyContent = messagesPassedToAnthropicClient.every((msg: any) =>
			msg.content.some((content: any) => content.type === 'text' && content.text === nonEmptyText)
		);
		assert.strictEqual(hasMessageWithNonEmptyContent, true, 'Messages with non-empty content should be included');
	});

	suite('provideLanguageModelResponse processes LanguageModelToolCallPart and LanguageModelToolResultPart contents correctly', () => {
		// 1st tool call with empty result
		const toolCallId1 = 'test-tool-callId-1';
		const toolCallName1 = `${toolCallId1}-tool`;
		const toolCallInput1 = {};
		const toolCallEmptyPart = new vscode.LanguageModelToolCallPart(toolCallId1, toolCallName1, toolCallInput1);
		const emptyToolResultPart = new vscode.LanguageModelToolResultPart(toolCallId1, []);

		// 2nd tool call with non-empty result
		const toolCallId2 = 'test-tool-callId-2';
		const toolCallName2 = `${toolCallId2}-tool`;
		const toolCallInput2 = { goodDogs: 'infinite' };
		const nonEmptyText = 'good cats and turtles -- also infinite';
		const toolCallNonEmptyPart = new vscode.LanguageModelToolCallPart(toolCallId2, toolCallName2, toolCallInput2);
		const nonEmptyToolResultPart = new vscode.LanguageModelToolResultPart(toolCallId2, [
			new vscode.LanguageModelTextPart(nonEmptyText),
		]);

		// Define different test cases for tool calls and results
		const messagesWithToolContent: ChatMessageValidateInfo[] = [
			{
				testName: 'Tool call with empty result should be passed as-is',
				message: vscode.LanguageModelChatMessage.Assistant([toolCallEmptyPart]),
				validate: (content) => {
					assert.strictEqual(content.length, 1, 'Should be returned as a single part');
					const result = content[0];
					// result example: { type: 'tool_use', id: 'test-tool-callId-1', name: 'test-tool-callId-1-tool', input: { }}
					assert.strictEqual(result.id, toolCallId1, 'Tool call ID should match the expected ID');
					assert.strictEqual(result.name, toolCallName1, 'Tool call name should match the expected name');
					assert.strictEqual(result.input, toolCallInput1, 'Tool call input should match the expected input');
				},
			},
			{
				testName: 'Tool call with non-empty result should be passed as-is',
				message: vscode.LanguageModelChatMessage.Assistant([toolCallNonEmptyPart]),
				validate: (content) => {
					assert.strictEqual(content.length, 1, 'Should be returned as a single part');
					const result = content[0];
					// result example: { type: 'tool_use', id: 'test-tool-callId-2', name: 'test-tool-callId-2-tool', input: { goodDogs: 'infinite' } }
					assert.strictEqual(result.id, toolCallId2, 'Tool call ID should match the expected ID');
					assert.strictEqual(result.name, toolCallName2, 'Tool call name should match the expected name');
					assert.deepStrictEqual(result.input, toolCallInput2, 'Tool call input should match the expected input');
				}
			},
			{
				testName: 'Tool call with non-empty parts and empty text content should remove the empty text parts',
				message: vscode.LanguageModelChatMessage.Assistant([toolCallNonEmptyPart, new vscode.LanguageModelTextPart('')]),
				validate: (content) => {
					assert.strictEqual(content.length, 1, 'Should be returned as a single part');
					const result = content[0];
					// result example: { type: 'tool_use', id: 'test-tool-callId-2', name: 'test-tool-callId-2-tool', input: { goodDogs: 'infinite' } }
					assert.strictEqual(result.id, toolCallId2, 'Tool call ID should match the expected ID');
					assert.strictEqual(result.name, toolCallName2, 'Tool call name should match the expected name');
					assert.deepStrictEqual(result.input, toolCallInput2, 'Tool call input should match the expected input');
				}
			},
			{
				testName: 'Tool result with empty content should replace the content with a text placeholder',
				message: vscode.LanguageModelChatMessage.User([emptyToolResultPart]),
				validate: (content) => {
					assert.strictEqual(content.length, 1, 'Should be returned as a single part');
					const result = content[0];
					// result example: { type: 'tool_result', tool_use_id: 'test-tool-callId-1', content: [{ type: 'text', text: '' }] }
					assert.strictEqual(result.tool_use_id, toolCallId1, 'Tool result call ID should match the expected ID');
					assert.strictEqual(result.content.length, 1, 'Tool result content should contain a single text part');
					assert.strictEqual(result.content[0].type, 'text', 'Tool result content should be a text part');
					assert.strictEqual(result.content[0].text, EMPTY_TOOL_RESULT_PLACEHOLDER, 'Tool result content should be replaced with the empty tool result placeholder');
				},
			},
			{
				testName: 'Tool result with non-empty content should be passed as-is',
				message: vscode.LanguageModelChatMessage.User([nonEmptyToolResultPart]),
				validate: (content) => {
					assert.strictEqual(content.length, 1, 'Should be returned as a single part');
					const result = content[0];
					// result example: { type: 'tool_result', tool_use_id: 'test-tool-callId-2', content: [{ type: 'text', text: 'good cats and turtles -- also infinite' }] }
					assert.strictEqual(result.tool_use_id, toolCallId2, 'Tool result call ID should match the expected ID');
					assert.strictEqual(result.content.length, 1, 'Tool result content should contain a single text part');
					assert.strictEqual(result.content[0].type, 'text', 'Tool result content should be a text part');
					assert.strictEqual(result.content[0].text, nonEmptyText, 'Tool result content should match the expected text');
				}
			},
		];

		// Run each test case
		messagesWithToolContent.forEach((testCase) => {
			test(`${testCase.testName}`, async () => {
				const messages = [testCase.message];

				await model.provideLanguageModelResponse(
					messages,
					{},
					'test-extension',
					mockProgress,
					mockCancellationToken
				);

				const streamCall = mockClient.messages.stream.getCall(0);
				assert.ok(streamCall, 'Stream method was not called');

				const messagesPassedToAnthropicClient: vscode.LanguageModelChatMessage2[] = streamCall.args[0].messages;
				assert.strictEqual(messagesPassedToAnthropicClient.length, 1, 'Exactly one message should be passed to the Anthropic client');

				testCase.validate(messagesPassedToAnthropicClient[0].content);
			});
		});
	});
});

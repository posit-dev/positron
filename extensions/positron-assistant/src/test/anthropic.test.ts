/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as positron from 'positron';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { AnthropicLanguageModel, CacheControlOptions } from '../anthropic';
import { ModelConfig } from '../config';
import { EMPTY_TOOL_RESULT_PLACEHOLDER, languageModelCacheBreakpointPart } from '../utils.js';
import Anthropic from '@anthropic-ai/sdk';
import { MessageStream } from '@anthropic-ai/sdk/lib/MessageStream.js';
import { mock } from './utils.js';
import * as modelDefinitionsModule from '../modelDefinitions.js';
import * as helpersModule from '../modelResolutionHelpers.js';

class MockAnthropicClient {
	messages = {
		stream: sinon.stub<
			Parameters<Anthropic['messages']['stream']>,
			ReturnType<Anthropic['messages']['stream']>
		>().returns(mock<MessageStream>({
			on: (event, listener) => {
				if (event === 'streamEvent') {
					const _listener = listener as (event: Anthropic.Messages.RawMessageStreamEvent) => void;
					const events: Anthropic.Messages.RawMessageStreamEvent[] = [{
						type: 'message_start',
						message: {
							id: 'mock-message-id',
							model: 'mock-model',
							type: "message",
							stop_reason: null,
							stop_sequence: null,
							role: 'assistant',
							content: [],
							usage: {
								server_tool_use: null,
								cache_creation_input_tokens: 20,
								cache_read_input_tokens: 20,
								input_tokens: 80,
								output_tokens: 0,
								service_tier: "standard"
							},
						}
					}, {
						type: 'message_delta',
						delta: {
							stop_reason: "end_turn",
							stop_sequence: null,
						},
						usage: {
							server_tool_use: null,
							cache_creation_input_tokens: 20,
							cache_read_input_tokens: 20,
							input_tokens: 80,
							output_tokens: 50,
						},
					}];
					events.forEach(event => _listener(event));
				}
				return mock<MessageStream>({});
			},
			abort: () => { },
			done: () => Promise.resolve(),
			finalMessage: () => Promise.resolve(mock<Anthropic.Message>({})),
		}))
	};
}

type ChatMessageValidateInfo = {
	testName: string;
	message: vscode.LanguageModelChatMessage2;
	validate: (content: any[]) => void;
};

type MockAnthropicProgress = {
	report: sinon.SinonStub<Parameters<vscode.Progress<vscode.LanguageModelResponsePart2>['report']>, void>;
};

suite('AnthropicLanguageModel', () => {
	let model: AnthropicLanguageModel;
	let mockClient: MockAnthropicClient;
	let progress: MockAnthropicProgress;
	let cancellationToken: vscode.CancellationToken;

	setup(() => {
		// Create a mock Anthropic client
		mockClient = new MockAnthropicClient();

		// Create a mock configuration
		const config: ModelConfig = {
			id: 'test-model',
			name: 'Test Model',
			provider: 'anthropic-api',
			model: 'claude-test',
			apiKey: 'test-api-key', // pragma: allowlist secret
			type: positron.PositronLanguageModelType.Chat
		};

		// Create an instance of the AnthropicLanguageModel
		model = new AnthropicLanguageModel(config, undefined, undefined, mockClient as unknown as Anthropic);

		// Create mock progress
		progress = {
			report: sinon.stub()
		};

		// Create a cancellation token
		const cancellationTokenSource = new vscode.CancellationTokenSource();
		cancellationToken = cancellationTokenSource.token;
	});

	teardown(() => {
		sinon.restore();
	});

	/** Send the request to the model and return the internal request made to the Anthropic API client. */
	async function provideLanguageModelResponse(
		messages: vscode.LanguageModelChatMessage2[],
		options: vscode.ProvideLanguageModelChatResponseOptions = { requestInitiator: 'test', toolMode: vscode.LanguageModelChatToolMode.Auto },
	) {
		await model.provideLanguageModelChatResponse(
			model,
			messages,
			options,
			progress,
			cancellationToken
		);

		sinon.assert.calledOnce(mockClient.messages.stream);
		const body = mockClient.messages.stream.getCall(0).args[0];
		return { body };
	}

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
		const { body } = await provideLanguageModelResponse(messages);

		// We expect two messages with non-empty content to be passed to the Anthropic client
		const messagesPassedToAnthropicClient = body.messages;
		assert.strictEqual(messagesPassedToAnthropicClient.length, numOfMessagesToKeep, 'Only non-empty messages should be passed to the Anthropic client');

		// Verify each passed message has the non-empty content we expect
		const hasMessageWithNonEmptyContent = messagesPassedToAnthropicClient.every((msg: any) =>
			msg.content.some((content: any) => content.type === 'text' && content.text === nonEmptyText)
		);
		assert.strictEqual(hasMessageWithNonEmptyContent, true, 'Messages with non-empty content should be included');
	});


	suite('provideLanguageModelResponse response streaming behaviour', () => {
		test('token usage is streamed back as part of the response', async () => {
			const decoder = new TextDecoder();
			const messages = [vscode.LanguageModelChatMessage.User('Token usage test')];
			await provideLanguageModelResponse(messages);

			const initialData = progress.report.getCall(0).args[0];
			const initialExpected = { type: 'usage', data: { inputTokens: 100, outputTokens: 0, cachedTokens: 20 } };
			assert.ok(initialData instanceof vscode.LanguageModelDataPart, 'Initial response should be a LanguageModelDataPart');
			assert.strictEqual(initialData.mimeType, 'text/x-json', 'Initial response should have `application/json` mimeType');

			const initialObject = JSON.parse(decoder.decode(initialData.data));
			assert.ok("providerMetadata" in initialObject.data, 'Initial response contains additional provider specific metadata.');
			delete initialObject.data["providerMetadata"];
			assert.deepStrictEqual(initialObject, initialExpected, 'Remaining initial usage data should decode as expected');

			const finalData = progress.report.getCall(1).args[0];
			const finalExpected = { type: 'usage', data: { inputTokens: 100, outputTokens: 50, cachedTokens: 20 } };
			assert.ok(finalData instanceof vscode.LanguageModelDataPart, 'Final response should be a LanguageModelDataPart');
			assert.strictEqual(finalData.mimeType, 'text/x-json', 'Final response should have `application/json` mimeType');

			const finalObject = JSON.parse(decoder.decode(finalData.data));
			assert.ok("providerMetadata" in finalObject.data, 'Final response contains additional provider specific metadata.');
			delete finalObject.data["providerMetadata"];
			assert.deepStrictEqual(finalObject, finalExpected, 'Remaining final usage data should decode as expected');
		});
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

				const { body } = await provideLanguageModelResponse(messages);

				const messagesPassedToAnthropicClient = body.messages;
				assert.strictEqual(messagesPassedToAnthropicClient.length, 1, 'Exactly one message should be passed to the Anthropic client');

				assert.ok(typeof messagesPassedToAnthropicClient[0].content !== 'string', 'Expected a content block object, got a string');
				testCase.validate(messagesPassedToAnthropicClient[0].content);
			});
		});
	});

	suite('provideLanguageModelResponse cache_control behavior', () => {
		test('caches system prompt by default', async () => {
			const toolA = {
				name: 'toolA',
				description: 'Tool A',
				inputSchema: { type: 'object' as const, properties: {} },
			} satisfies vscode.LanguageModelChatTool;
			const toolB = {
				name: 'toolB',
				description: 'Tool B',
				inputSchema: { type: 'object' as const, properties: {} }
			} satisfies vscode.LanguageModelChatTool;
			const system = 'System prompt';

			// Call the method under test.
			const { body } = await provideLanguageModelResponse(
				[
					new vscode.LanguageModelChatMessage(vscode.LanguageModelChatMessageRole.System, system),
					vscode.LanguageModelChatMessage.User('Hi'),
					vscode.LanguageModelChatMessage.User('Bye'),
				],
				{
					// Define the request tools, not sorted by name, so we can test sorting behavior.
					tools: [toolB, toolA],
					modelOptions: {},
					requestInitiator: 'test',
					toolMode: vscode.LanguageModelChatToolMode.Auto,
				},
			);

			assert.deepStrictEqual(body.tools, [
				{
					name: toolA.name,
					description: toolA.description,
					input_schema: toolA.inputSchema,
				},
				{
					name: toolB.name,
					description: toolB.description,
					input_schema: toolB.inputSchema,
				},
			] satisfies Anthropic.ToolUnion[], 'Unexpected tools in request body');

			assert.deepStrictEqual(body.system, [
				{
					type: 'text',
					text: system,
					cache_control: { type: 'ephemeral' },
				},
			] satisfies Anthropic.TextBlockParam[], 'Unexpected system prompt in request body');

			assert.deepStrictEqual(body.messages, [
				{ role: 'user', content: [{ type: 'text', text: 'Hi' }] },
				{ role: 'user', content: [{ type: 'text', text: 'Bye' }] },
			] satisfies Anthropic.MessageCreateParams['messages'], 'Unexpected user messages in request body');
		});

		test('does not cache system prompt when disabled', async () => {
			const toolA = {
				name: 'toolA',
				description: 'Tool A',
				inputSchema: { type: 'object' as const, properties: {} }
			} satisfies vscode.LanguageModelChatTool;
			const toolB = {
				name: 'toolB',
				description: 'Tool B',
				inputSchema: { type: 'object' as const, properties: {} }
			} satisfies vscode.LanguageModelChatTool;
			const system = 'System prompt';

			// Call the method under test with no cacheControl options to test default behavior.
			const { body } = await provideLanguageModelResponse(
				[
					new vscode.LanguageModelChatMessage(vscode.LanguageModelChatMessageRole.System, system),
					vscode.LanguageModelChatMessage.User('Hi'),
					vscode.LanguageModelChatMessage.User('Bye'),
				],
				{
					// Define the request tools, not sorted by name, so we can test sorting behavior.
					tools: [toolB, toolA],
					modelOptions: {
						cacheControl: {
							system: false,
						} satisfies CacheControlOptions,
					},
					requestInitiator: 'test',
					toolMode: vscode.LanguageModelChatToolMode.Auto,
				},
			);

			assert.deepStrictEqual(body.tools, [
				{
					name: toolA.name,
					description: toolA.description,
					input_schema: toolA.inputSchema,
				},
				{
					name: toolB.name,
					description: toolB.description,
					input_schema: toolB.inputSchema,
				},
			] satisfies Anthropic.ToolUnion[], 'Unexpected tools in request body');

			assert.deepStrictEqual(body.system, [
				{
					type: 'text',
					text: system,
				},
			] satisfies Anthropic.TextBlockParam[], 'Unexpected system prompt in request body');

			assert.deepStrictEqual(body.messages, [
				{ role: 'user', content: [{ type: 'text', text: 'Hi' }] },
				{ role: 'user', content: [{ type: 'text', text: 'Bye' }] },
			] satisfies Anthropic.MessageCreateParams['messages'], 'Unexpected user messages in request body');
		});

		test('applies cache_control to previous text part in same message', async () => {
			const { body } = await provideLanguageModelResponse([
				vscode.LanguageModelChatMessage2.User([
					new vscode.LanguageModelTextPart('Hello world'),
					languageModelCacheBreakpointPart(),
				])
			]);

			assert.deepStrictEqual(body.messages, [
				{
					role: 'user',
					content: [
						{
							type: 'text',
							text: 'Hello world',
							cache_control: { type: 'ephemeral' }
						}
					]
				}
			] satisfies Anthropic.MessageCreateParams['messages'], 'Unexpected user messages in request body');
		});

		test('applies cache_control to previous tool call part in same message', async () => {
			const { body } = await provideLanguageModelResponse([
				vscode.LanguageModelChatMessage2.Assistant([
					new vscode.LanguageModelToolCallPart('call-1', 'test-tool', { input: 'test' }),
					languageModelCacheBreakpointPart(),
				])
			]);

			assert.deepStrictEqual(body.messages, [
				{
					role: 'assistant',
					content: [
						{
							type: 'tool_use',
							id: 'call-1',
							name: 'test-tool',
							input: { input: 'test' },
							cache_control: { type: 'ephemeral' }
						}
					]
				}
			] satisfies Anthropic.MessageCreateParams['messages'], 'Unexpected user messages in request body');
		});

		test('applies cache_control to previous tool result part in same message', async () => {
			const { body } = await provideLanguageModelResponse([
				vscode.LanguageModelChatMessage2.User([
					new vscode.LanguageModelToolResultPart('call-1', [new vscode.LanguageModelTextPart('result')]),
					languageModelCacheBreakpointPart()
				])
			]);

			assert.deepStrictEqual(body.messages, [
				{
					role: 'user',
					content: [
						{
							type: 'tool_result',
							tool_use_id: 'call-1',
							content: [{ type: 'text', text: 'result' }],
							cache_control: { type: 'ephemeral' }
						}
					]
				}
			] satisfies Anthropic.MessageCreateParams['messages'], 'Unexpected user messages in request body');
		});

		test('ignores cache_control when there is no previous part', async () => {
			const { body } = await provideLanguageModelResponse([
				vscode.LanguageModelChatMessage2.User([
					(languageModelCacheBreakpointPart()),
				])
			]);

			assert.deepStrictEqual(body.messages, [] satisfies Anthropic.MessageCreateParams['messages'], 'Unexpected user messages in request body');
		});

		test('applies multiple cache_control parts to respective previous parts', async () => {
			const { body } = await provideLanguageModelResponse([
				vscode.LanguageModelChatMessage2.User([
					new vscode.LanguageModelTextPart('First part'),
					languageModelCacheBreakpointPart(),
					new vscode.LanguageModelTextPart('Second part'),
					languageModelCacheBreakpointPart(),
				])
			]);

			assert.deepStrictEqual(body.messages, [
				{
					role: 'user',
					content: [
						{
							type: 'text',
							text: 'First part',
							cache_control: { type: 'ephemeral' }
						},
						{
							type: 'text',
							text: 'Second part',
							cache_control: { type: 'ephemeral' }
						}
					]
				}
			] satisfies Anthropic.MessageCreateParams['messages'], 'Unexpected user messages in request body');
		});

		test('ignores non-cache_control LanguageModelDataPart', async () => {
			const { body } = await provideLanguageModelResponse([
				vscode.LanguageModelChatMessage2.User([
					new vscode.LanguageModelTextPart('Hello world'),
					vscode.LanguageModelDataPart.json({ data: 'value' })
				])
			]);

			assert.deepStrictEqual(body.messages, [
				{
					role: 'user',
					content: [
						{
							type: 'text',
							text: 'Hello world'
						}
					]
				}
			] satisfies Anthropic.MessageCreateParams['messages'], 'Unexpected user messages in request body');
		});

		test('cache_control part applies to most recent valid content part', async () => {
			const { body } = await provideLanguageModelResponse([
				vscode.LanguageModelChatMessage2.User([
					new vscode.LanguageModelTextPart('Hello world'),
					new vscode.LanguageModelTextPart(''),
					languageModelCacheBreakpointPart(),
				])
			]);

			assert.deepStrictEqual(body.messages, [
				{
					role: 'user',
					content: [
						{
							type: 'text',
							text: 'Hello world',
							cache_control: { type: 'ephemeral' }
						}
					]
				}
			] satisfies Anthropic.MessageCreateParams['messages'], 'Unexpected user messages in request body');
		});
	});

	suite('Model Resolution', () => {
		let mockWorkspaceConfig: sinon.SinonStub;
		let mockModelDefinitions: sinon.SinonStub;
		let mockHelpers: { createModelInfo: sinon.SinonStub; isDefaultUserModel: sinon.SinonStub; markDefaultModel: sinon.SinonStub };
		let getConfigurationStub: sinon.SinonStub;

		setup(() => {
			// Mock vscode.workspace.getConfiguration for model resolution tests
			mockWorkspaceConfig = sinon.stub();
			getConfigurationStub = sinon.stub(vscode.workspace, 'getConfiguration').returns({
				get: mockWorkspaceConfig
			} as any);

			// Mock getAllModelDefinitions
			mockModelDefinitions = sinon.stub(modelDefinitionsModule, 'getAllModelDefinitions');

			// Mock helper functions
			mockHelpers = {
				createModelInfo: sinon.stub(helpersModule, 'createModelInfo'),
				isDefaultUserModel: sinon.stub(helpersModule, 'isDefaultUserModel'),
				markDefaultModel: sinon.stub(helpersModule, 'markDefaultModel')
			};
		});

		teardown(() => {
			// Restore specific stubs for this suite
			getConfigurationStub.restore();
			mockModelDefinitions.restore();
			mockHelpers.createModelInfo.restore();
			mockHelpers.isDefaultUserModel.restore();
			mockHelpers.markDefaultModel.restore();
		});

		suite('retrieveModelsFromConfig', () => {
			test('returns undefined when no configured models', () => {
				mockModelDefinitions.returns([]);
				const result = (model as any).retrieveModelsFromConfig();
				assert.strictEqual(result, undefined);
			});

			test('returns configured models when built-in models exist', () => {
				const builtInModels = [
					{
						name: 'Claude Sonnet 4.5',
						identifier: 'claude-sonnet-4-5',
						maxInputTokens: 200_000,
						maxOutputTokens: 64_000
					}
				];
				mockModelDefinitions.returns(builtInModels);

				const mockModelInfo = {
					id: 'claude-sonnet-4-5',
					name: 'Claude Sonnet 4.5',
					family: 'anthropic-api',
					version: '',
					maxInputTokens: 200_000,
					maxOutputTokens: 64_000,
					capabilities: { vision: true, toolCalling: true, agentMode: true },
					isDefault: true,
					isUserSelectable: true
				};
				mockHelpers.createModelInfo.returns(mockModelInfo);
				mockHelpers.markDefaultModel.returns([mockModelInfo]);

				const result = (model as any).retrieveModelsFromConfig();

				assert.ok(result, 'Should return built-in models');
				assert.strictEqual(result.length, 1);
				assert.strictEqual(result[0].id, 'claude-sonnet-4-5');
			});

			test('marks one model as default', () => {
				const configuredModels = [
					{ name: 'Claude A', identifier: 'claude-a' },
					{ name: 'Claude B', identifier: 'claude-b' }
				];
				mockModelDefinitions.returns(configuredModels);

				const mockModelInfoA = { id: 'claude-a', name: 'Claude A', isDefault: false, isUserSelectable: true };
				const mockModelInfoB = { id: 'claude-b', name: 'Claude B', isDefault: false, isUserSelectable: true };
				mockHelpers.createModelInfo.onFirstCall().returns(mockModelInfoA);
				mockHelpers.createModelInfo.onSecondCall().returns(mockModelInfoB);

				// Mock markDefaultModel to return the expected result with claude-b as default
				const expectedResult = [
					{ id: 'claude-a', name: 'Claude A', isDefault: false, isUserSelectable: true },
					{ id: 'claude-b', name: 'Claude B', isDefault: true, isUserSelectable: true }
				];
				mockHelpers.markDefaultModel.returns(expectedResult);

				const result = (model as any).retrieveModelsFromConfig();

				assert.ok(result, 'Should return models');
				assert.strictEqual(result.length, 2);
				// Only one should be marked as default
				const defaultModels = result.filter((m: any) => m.isDefault);
				assert.strictEqual(defaultModels.length, 1);
				assert.strictEqual(defaultModels[0].id, 'claude-b');
			});

			test('falls back to DEFAULT_ANTHROPIC_MODEL_MATCH for default', () => {
				const configuredModels = [
					{ name: 'Claude Sonnet 4.5', identifier: 'claude-sonnet-4-5' }
				];
				mockModelDefinitions.returns(configuredModels);

				const mockModelInfo = { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', isDefault: false, isUserSelectable: true };
				mockHelpers.createModelInfo.returns(mockModelInfo);

				// Mock markDefaultModel to return the expected result with the model as default
				const expectedResult = [
					{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', isDefault: true, isUserSelectable: true }
				];
				mockHelpers.markDefaultModel.returns(expectedResult);

				const result = (model as any).retrieveModelsFromConfig();

				const defaultModel = result.find((m: any) => m.isDefault);
				assert.ok(defaultModel, 'Should have a default model');
				assert.strictEqual(defaultModel.id, 'claude-sonnet-4-5');

				// Verify markDefaultModel was called with the correct parameters
				sinon.assert.calledWith(mockHelpers.markDefaultModel, [mockModelInfo], 'anthropic-api', 'claude-sonnet-4');
			});
		});

		suite('resolveModels integration', () => {
			let cancellationToken: vscode.CancellationToken;

			setup(() => {
				const cancellationTokenSource = new vscode.CancellationTokenSource();
				cancellationToken = cancellationTokenSource.token;
			});

			test('prioritizes configured models over API', async () => {
				const configuredModels = [
					{ name: 'User Claude', identifier: 'user-claude' }
				];
				mockModelDefinitions.returns(configuredModels);

				const mockModelInfo = {
					id: 'user-claude',
					name: 'User Claude',
					isDefault: true,
					isUserSelectable: true
				};
				mockHelpers.createModelInfo.returns(mockModelInfo);
				mockHelpers.markDefaultModel.returns([mockModelInfo]);

				const result = await model.resolveModels(cancellationToken);

				assert.ok(result, 'Should return configured models');
				assert.strictEqual(result.length, 1);
				assert.strictEqual(result[0].id, 'user-claude');
				assert.strictEqual(model.modelListing, result);
			});

			test('falls back to API when no configured models', async () => {
				mockModelDefinitions.returns([]); // No configured models

				const mockAnthropicClient = {
					models: {
						list: sinon.stub().resolves({
							data: [
								{ id: 'claude-api-model', display_name: 'Claude API Model', created_at: '2025-01-01T00:00:00Z' }
							],
							has_more: false
						})
					}
				};
				(model as any)._client = mockAnthropicClient;

				const mockModelInfo = {
					id: 'claude-api-model',
					name: 'Claude API Model',
					isDefault: true,
					isUserSelectable: true
				};
				mockHelpers.createModelInfo.returns(mockModelInfo);
				mockHelpers.markDefaultModel.returns([mockModelInfo]);

				const result = await model.resolveModels(cancellationToken);

				assert.ok(result, 'Should return API models');
				assert.strictEqual(result.length, 1);
				assert.strictEqual(result[0].id, 'claude-api-model');
				assert.strictEqual(model.modelListing, result);
			});

			test('returns undefined when both configured and API fail', async () => {
				mockModelDefinitions.returns([]); // No configured models

				const mockAnthropicClient = {
					models: {
						list: sinon.stub().rejects(new Error('API Error'))
					}
				};
				(model as any)._client = mockAnthropicClient;

				const result = await model.resolveModels(cancellationToken);

				assert.strictEqual(result, undefined);
			});

			test('caches resolved models in modelListing', async () => {
				const configuredModels = [
					{ name: 'Cached Claude', identifier: 'cached-claude' }
				];
				mockModelDefinitions.returns(configuredModels);

				const mockModelInfo = {
					id: 'cached-claude',
					name: 'Cached Claude',
					isDefault: true,
					isUserSelectable: true
				};
				mockHelpers.createModelInfo.returns(mockModelInfo);
				mockHelpers.markDefaultModel.returns([mockModelInfo]);

				await model.resolveModels(cancellationToken);

				assert.strictEqual(model.modelListing.length, 1);
				assert.strictEqual(model.modelListing[0].id, 'cached-claude');
			});
		});
	});
});

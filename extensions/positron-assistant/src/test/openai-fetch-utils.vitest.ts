/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
/// <reference types="vitest/globals" />

// @vitest-environment node

import { fixPossiblyBrokenChatCompletionChunk, PossiblyBrokenChatCompletionChunk } from '../openai-fetch-utils.js';

describe('OpenAI Fetch Utils', () => {
	it('fixPossiblyBrokenChatCompletionChunk fixes empty arguments for no-arg tools', () => {
		const brokenChunk: PossiblyBrokenChatCompletionChunk = {
			id: 'test-id',
			choices: [{
				index: 0,
				delta: {
					role: 'assistant',
					tool_calls: [{
						index: 0,
						id: 'call_123',
						type: 'function',
						function: {
							name: 'getPlot',
							arguments: ''
						}
					}]
				},
				finish_reason: null
			}],
			created: 1234567890,
			model: 'test-model',
			object: 'chat.completion.chunk'
		};

		const noArgTools = ['getPlot'];
		const fixedChunk = fixPossiblyBrokenChatCompletionChunk(brokenChunk, noArgTools);
		const choice = fixedChunk.choices[0];
		const toolCall = choice.delta.tool_calls![0];

		expect(toolCall.function?.arguments).toBe('{}');
	});

	it('fixPossiblyBrokenChatCompletionChunk does NOT fix empty arguments for tools with args', () => {
		const chunk: PossiblyBrokenChatCompletionChunk = {
			id: 'test-id',
			choices: [{
				index: 0,
				delta: {
					role: 'assistant',
					tool_calls: [{
						index: 0,
						id: 'call_123',
						type: 'function',
						function: {
							name: 'myTool',
							arguments: ''
						}
					}]
				},
				finish_reason: null
			}],
			created: 1234567890,
			model: 'test-model',
			object: 'chat.completion.chunk'
		};

		const noArgTools = ['getPlot']; // myTool is not in the list
		const fixedChunk = fixPossiblyBrokenChatCompletionChunk(chunk, noArgTools);
		const choice = fixedChunk.choices[0];
		const toolCall = choice.delta.tool_calls![0];

		expect(toolCall.function?.arguments).toBe('');
	});

	it('fixPossiblyBrokenChatCompletionChunk preserves valid arguments', () => {
		const chunk: PossiblyBrokenChatCompletionChunk = {
			id: 'test-id',
			choices: [{
				index: 0,
				delta: {
					role: 'assistant',
					tool_calls: [{
						index: 0,
						id: 'call_123',
						type: 'function',
						function: {
							name: 'testTool',
							arguments: '{"foo":"bar"}'
						}
					}]
				},
				finish_reason: null
			}],
			created: 1234567890,
			model: 'test-model',
			object: 'chat.completion.chunk'
		};

		const fixedChunk = fixPossiblyBrokenChatCompletionChunk(chunk, []);
		const choice = fixedChunk.choices[0];
		const toolCall = choice.delta.tool_calls![0];

		expect(toolCall.function?.arguments).toBe('{"foo":"bar"}');
	});
});

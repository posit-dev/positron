/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { fixPossiblyBrokenChatCompletionChunk, PossiblyBrokenChatCompletionChunk } from '../openai-fetch-utils.js';

suite('OpenAI Fetch Utils', () => {
	test('fixPossiblyBrokenChatCompletionChunk fixes empty arguments for no-arg tools', () => {
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

		assert.strictEqual(toolCall.function?.arguments, '{}', 'Empty arguments should be converted to "{}" for no-arg tool');
	});

	test('fixPossiblyBrokenChatCompletionChunk does NOT fix empty arguments for tools with args', () => {
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

		assert.strictEqual(toolCall.function?.arguments, '', 'Empty arguments should be preserved for tool with args');
	});

	test('fixPossiblyBrokenChatCompletionChunk preserves valid arguments', () => {
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

		assert.strictEqual(toolCall.function?.arguments, '{"foo":"bar"}', 'Valid arguments should be preserved');
	});
});

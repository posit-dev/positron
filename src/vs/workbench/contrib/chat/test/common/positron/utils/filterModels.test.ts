/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../../base/test/common/utils.js';
import { matchesModelFilter } from '../../../../common/positron/utils/filterModels.js';

suite('matchesModelFilter', function () {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('handles realistic model naming patterns', function () {
		const testCases = [
			{
				description: 'Versioned model matching',
				pattern: 'v2',
				identifier: 'provider/model-v2.1',
				id: 'model-v2.1',
				name: 'Model Version 2.1',
				shouldMatch: true
			},
			{
				description: 'Provider-specific naming',
				pattern: 'anthropic',
				identifier: 'anthropic-api/claude-opus-4-20250514',
				id: 'claude-opus-4-20250514',
				name: 'Claude Opus 4',
				shouldMatch: true
			},
			{
				description: 'Model size matching',
				pattern: 'small',
				identifier: 'provider/llama-7b-small',
				id: 'llama-7b-small',
				name: 'Llama 7B Small',
				shouldMatch: true
			},
			{
				description: 'Date-based model versions',
				pattern: '2025',
				identifier: 'anthropic-api/claude-opus-4-20250514',
				id: 'claude-opus-4-20250514',
				name: 'Claude Opus 4',
				shouldMatch: true
			},
			{
				description: 'Model parameter size matching',
				pattern: '7b',
				identifier: 'meta/llama-2-7b-chat',
				id: 'llama-2-7b-chat',
				name: 'Llama 2 7B Chat',
				shouldMatch: true
			},
			{
				description: 'Model capability matching',
				pattern: 'chat',
				identifier: 'openai-api/gpt-4o-chat',
				id: 'gpt-4o-chat',
				name: 'GPT-4o Chat',
				shouldMatch: true
			},
			{
				description: 'Model variant matching',
				pattern: 'instruct',
				identifier: 'meta/llama-2-13b-chat-instruct',
				id: 'llama-2-13b-chat-instruct',
				name: 'Llama 2 13B Chat Instruct',
				shouldMatch: true
			},
			{
				description: 'Claude model matching',
				pattern: 'claude',
				identifier: 'anthropic-api/claude-opus-4-20250514',
				id: 'claude-opus-4-20250514',
				name: 'Claude Opus 4',
				shouldMatch: true
			},
		];

		testCases.forEach(testCase => {
			const matches = matchesModelFilter(
				testCase.pattern,
				testCase.identifier,
				testCase.id,
				testCase.name
			);

			assert.strictEqual(
				matches,
				testCase.shouldMatch,
				`${testCase.description}: pattern "${testCase.pattern}" should ${testCase.shouldMatch ? 'match' : 'not match'} model with identifier="${testCase.identifier}", id="${testCase.id}", name="${testCase.name}"`
			);
		});
	});


	test('works with glob patterns', function () {
		const testCases = [
			{
				description: 'Explicit wildcard pattern',
				pattern: '*claude*',
				identifier: 'anthropic-api/claude-opus-4-20250514',
				id: 'claude-opus-4-20250514',
				name: 'Claude Opus 4',
				shouldMatch: true
			},
			{
				description: 'Hierarchical wildcard pattern',
				pattern: '**/gpt*',
				identifier: 'openai-compatible/openai/gpt-5',
				id: 'openai/gpt-5',
				name: 'openai/gpt-5',
				shouldMatch: true
			},
			{
				description: 'Non-matching wildcard pattern',
				pattern: '*llama*',
				identifier: 'anthropic-api/claude-opus-4-20250514',
				id: 'claude-opus-4-20250514',
				name: 'Claude Opus 4',
				shouldMatch: false
			}
		];

		testCases.forEach(testCase => {
			const matches = matchesModelFilter(
				testCase.pattern,
				testCase.identifier,
				testCase.id,
				testCase.name
			);

			assert.strictEqual(
				matches,
				testCase.shouldMatch,
				`${testCase.description}: pattern "${testCase.pattern}" should ${testCase.shouldMatch ? 'match' : 'not match'} model`
			);
		});
	});

	test('handles edge cases and empty inputs', function () {
		const testCases = [
			{
				description: 'Empty pattern',
				pattern: '',
				identifier: 'openai-api/gpt-4',
				id: 'gpt-4',
				name: 'GPT-4',
				shouldMatch: true // Empty pattern should match everything
			},
			{
				description: 'Whitespace-only pattern',
				pattern: '   ',
				identifier: 'openai-api/gpt-4',
				id: 'gpt-4',
				name: 'GPT-4',
				shouldMatch: true // Trimmed empty pattern should match everything
			},
			{
				description: 'Empty strings in model fields',
				pattern: 'test',
				identifier: '',
				id: '',
				name: '',
				shouldMatch: false
			},
			{
				description: 'Pattern with leading/trailing whitespace',
				pattern: '  claude  ',
				identifier: 'anthropic-api/claude-opus-4',
				id: 'claude-opus-4',
				name: 'Claude Opus 4',
				shouldMatch: true
			},
			{
				description: 'Non-matching pattern',
				pattern: 'llama',
				identifier: 'anthropic-api/claude-opus-4-20250514',
				id: 'claude-opus-4-20250514',
				name: 'Claude Opus 4',
				shouldMatch: false
			}
		];

		testCases.forEach(testCase => {
			const matches = matchesModelFilter(
				testCase.pattern,
				testCase.identifier,
				testCase.id,
				testCase.name
			);

			assert.strictEqual(
				matches,
				testCase.shouldMatch,
				`${testCase.description}: pattern "${testCase.pattern}" should ${testCase.shouldMatch ? 'match' : 'not match'} model with identifier="${testCase.identifier}", id="${testCase.id}", name="${testCase.name}"`
			);
		});
	});

});

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as positron from 'positron';
import { resolveVariableNamesToAccessKeys } from '../../tools.js';

suite('resolveVariableNamesToAccessKeys', () => {
	let getSessionVariablesStub: sinon.SinonStub;

	setup(() => {
		// Stub the positron.runtime.getSessionVariables API
		getSessionVariablesStub = sinon.stub(positron.runtime, 'getSessionVariables');
	});

	teardown(() => {
		sinon.restore();
	});

	test('should resolve variable names to access keys when all found', async () => {
		// Mock session variables with different access key formats (simulating Python and R)
		const mockVariables: positron.RuntimeVariable[][] = [[
			{
				display_name: 'df',
				access_key: '{"type":"str","data":"df"}',
				display_type: 'DataFrame',
				display_value: '<DataFrame>',
				length: 100,
				size: 1024,
				has_children: true
			},
			{
				display_name: 'x',
				access_key: '{"type":"str","data":"x"}',
				display_type: 'int',
				display_value: '42',
				length: 1,
				size: 28,
				has_children: false
			}
		]];

		getSessionVariablesStub.resolves(mockVariables);

		const result = await resolveVariableNamesToAccessKeys('test-session', ['df', 'x']);

		assert.deepStrictEqual(result, {
			accessKeys: [
				['{"type":"str","data":"df"}'],
				['{"type":"str","data":"x"}']
			],
			allFound: true,
			notFound: []
		});

		// Verify the API was called with correct session ID and no access keys
		sinon.assert.calledOnceWithExactly(getSessionVariablesStub, 'test-session');
	});

	test('should resolve R-style simple access keys', async () => {
		// R uses simple variable names as access keys
		const mockVariables: positron.RuntimeVariable[][] = [[
			{
				display_name: 'my_data',
				access_key: 'my_data',
				display_type: 'data.frame',
				display_value: '<data.frame>',
				length: 50,
				size: 512,
				has_children: true
			}
		]];

		getSessionVariablesStub.resolves(mockVariables);

		const result = await resolveVariableNamesToAccessKeys('r-session', ['my_data']);

		assert.deepStrictEqual(result, {
			accessKeys: [['my_data']],
			allFound: true,
			notFound: []
		});
	});

	test('should return all variables when requested name not found', async () => {
		// Session has some variables, but requested one doesn't exist
		const mockVariables: positron.RuntimeVariable[][] = [[
			{
				display_name: 'df',
				access_key: 'df_key',
				display_type: 'DataFrame',
				display_value: '<DataFrame>',
				length: 100,
				size: 1024,
				has_children: true
			},
			{
				display_name: 'x',
				access_key: 'x_key',
				display_type: 'int',
				display_value: '42',
				length: 1,
				size: 28,
				has_children: false
			}
		]];
		getSessionVariablesStub.resolves(mockVariables);

		const result = await resolveVariableNamesToAccessKeys('test-session', ['unknown_var']);

		// Should return all variables and indicate the name was not found
		assert.deepStrictEqual(result, {
			accessKeys: [['df_key'], ['x_key']],
			allFound: false,
			notFound: ['unknown_var']
		});
	});

	test('should return all variables when any name not found (mixed case)', async () => {
		const mockVariables: positron.RuntimeVariable[][] = [[
			{
				display_name: 'exists',
				access_key: '{"type":"str","data":"exists"}',
				display_type: 'list',
				display_value: '[1, 2, 3]',
				length: 3,
				size: 100,
				has_children: true
			}
		]];

		getSessionVariablesStub.resolves(mockVariables);

		const result = await resolveVariableNamesToAccessKeys('test-session', ['exists', 'not_found']);

		// Even though 'exists' was found, 'not_found' wasn't, so return all variables
		assert.deepStrictEqual(result, {
			accessKeys: [['{"type":"str","data":"exists"}']],
			allFound: false,
			notFound: ['not_found']
		});
	});

	test('should handle empty variable names array', async () => {
		const mockVariables: positron.RuntimeVariable[][] = [[
			{
				display_name: 'df',
				access_key: 'df',
				display_type: 'DataFrame',
				display_value: '<DataFrame>',
				length: 10,
				size: 100,
				has_children: true
			}
		]];

		getSessionVariablesStub.resolves(mockVariables);

		const result = await resolveVariableNamesToAccessKeys('test-session', []);

		assert.deepStrictEqual(result, {
			accessKeys: [],
			allFound: true,
			notFound: []
		});
	});

	test('should return empty when session has no variables and name not found', async () => {
		// getSessionVariables returns empty outer array
		getSessionVariablesStub.resolves([]);

		const result = await resolveVariableNamesToAccessKeys('empty-session', ['some_var']);

		// No variables to return, but still indicate not found
		assert.deepStrictEqual(result, {
			accessKeys: [],
			allFound: false,
			notFound: ['some_var']
		});
	});

	test('should handle duplicate display names by using last match', async () => {
		// Edge case: multiple variables with same display_name (shouldn't happen, but test behavior)
		const mockVariables: positron.RuntimeVariable[][] = [[
			{
				display_name: 'dup',
				access_key: 'first_key',
				display_type: 'int',
				display_value: '1',
				length: 1,
				size: 28,
				has_children: false
			},
			{
				display_name: 'dup',
				access_key: 'second_key',
				display_type: 'int',
				display_value: '2',
				length: 1,
				size: 28,
				has_children: false
			}
		]];

		getSessionVariablesStub.resolves(mockVariables);

		const result = await resolveVariableNamesToAccessKeys('test-session', ['dup']);

		// Map.set overwrites, so last one wins
		assert.deepStrictEqual(result, {
			accessKeys: [['second_key']],
			allFound: true,
			notFound: []
		});
	});

	test('should return all variables when nested path not found', async () => {
		// When a user references a nested variable like "df.column", the function
		// won't find it in the top-level variables. Since it's not found, it returns
		// all available variables to help the model discover what's available.
		const mockVariables: positron.RuntimeVariable[][] = [[
			{
				display_name: 'df',
				access_key: '{"type":"str","data":"df"}',
				display_type: 'DataFrame',
				display_value: '<DataFrame>',
				length: 100,
				size: 1024,
				has_children: true
			}
		]];

		getSessionVariablesStub.resolves(mockVariables);

		// "df.column" won't match "df" exactly
		const result = await resolveVariableNamesToAccessKeys('test-session', ['df.column']);

		// Returns all variables since the requested name wasn't found
		assert.deepStrictEqual(result, {
			accessKeys: [['{"type":"str","data":"df"}']],
			allFound: false,
			notFound: ['df.column']
		});
	});
});

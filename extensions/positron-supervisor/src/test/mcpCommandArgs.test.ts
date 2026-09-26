/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CommandArgSpec, checkCommandArgs } from '../mcpCommandArgs';

/** A command taking a path, a line number, and a flag. */
const OPEN_FILE: CommandArgSpec[] = [
	{ name: 'path', schema: { type: 'string' } },
	{ name: 'line', schema: { type: 'integer' } },
	{ name: 'preview', schema: { type: ['boolean', 'object'] } },
];

suite('checkCommandArgs', () => {
	test('accepts arguments of the right types, and ones left out', () => {
		assert.deepStrictEqual(
			[
				checkCommandArgs(OPEN_FILE, []),
				checkCommandArgs(OPEN_FILE, ['a.R', 3, true]),
				checkCommandArgs(OPEN_FILE, ['a.R', null, {}]),
				checkCommandArgs([{ name: 'anything' }], [{ nested: [1] }]),
			],
			[undefined, undefined, undefined, undefined]);
	});

	test('refuses mistyped arguments', () => {
		assert.deepStrictEqual(
			[
				checkCommandArgs(OPEN_FILE, [42]),
				checkCommandArgs(OPEN_FILE, ['a.R', 1.5]),
				checkCommandArgs(OPEN_FILE, ['a.R', 1, 'yes']),
			],
			[
				`Argument 'path' must be string, not number`,
				`Argument 'line' must be integer, not number`,
				`Argument 'preview' must be boolean or object, not string`,
			]);
	});
});

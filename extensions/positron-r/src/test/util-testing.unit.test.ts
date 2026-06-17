/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { escapeLabelForRDesc } from '../testing/util-testing';

suite('escapeLabelForRDesc', () => {
	const cases: Record<string, [input: string, expected: string]> = {
		'leaves a plain label untouched': ['plain label', 'plain label'],
		'escapes single quotes': ['it\'s fine', 'it\\\'s fine'],
		'escapes double quotes and backticks': ['a "b" `c`', 'a \\"b\\" \\`c\\`'],
		'escapes a LF newline': ['multi\nline', 'multi\\nline'],
	};

	for (const [name, [input, expected]] of Object.entries(cases)) {
		test(name, () => {
			assert.strictEqual(escapeLabelForRDesc(input), expected);
		});
	}
});

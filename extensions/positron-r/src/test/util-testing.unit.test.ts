/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { escapeLabelForRDesc } from '../testing/util-testing';

suite('escapeLabelForRDesc', () => {
	// A raw newline in the label breaks the single-test run on Windows (#10133),
	// so newlines must be escaped (not collapsed) for R to reconstruct them.
	const cases: Record<string, [input: string, expected: string]> = {
		'leaves a plain label untouched': ['plain label', 'plain label'],
		'escapes single quotes': ['it\'s fine', 'it\\\'s fine'],
		'escapes double quotes and backticks': ['a "b" `c`', 'a \\"b\\" \\`c\\`'],
		'escapes a LF newline': ['multi\nline', 'multi\\nline'],
		'preserves a CRLF newline': ['multi\r\nline', 'multi\\r\\nline'],
		'escapes a lone CR': ['multi\rline', 'multi\\rline'],
	};

	for (const [name, [input, expected]] of Object.entries(cases)) {
		test(name, () => {
			assert.strictEqual(escapeLabelForRDesc(input), expected);
		});
	}
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { escapeLabelForRDesc } from '../testing/util-testing';

suite('escapeLabelForRDesc', () => {
	const cases: Record<string, [input: string, expected: string]> = {
		'leaves an empty label untouched': ['', ''],
		'leaves a plain label untouched': ['plain label', 'plain label'],
		'escapes single quotes': ['it\'s a \'test\'', 'it\\\'s a \\\'test\\\''],
		'escapes newlines': ['a\nb\nc', 'a\\nb\\nc'],
		'escapes single quotes and newlines together': ['line \'one\'\nline \'two\'', 'line \\\'one\\\'\\nline \\\'two\\\''],
		'leaves double quotes, backticks, and backslashes untouched': ['a "b" `c` d\\e & f / g', 'a "b" `c` d\\e & f / g'],
	};

	for (const [name, [input, expected]] of Object.entries(cases)) {
		test(name, () => {
			assert.strictEqual(escapeLabelForRDesc(input), expected);
		});
	}
});

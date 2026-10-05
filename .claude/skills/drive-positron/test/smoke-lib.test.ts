/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstRow, nameWords } from './smoke-lib.ts';

test('nameWords keeps the version and the env name', () => {
	assert.equal(nameWords('Python 3.10.12 (uv: ws)'), '3.10.12 ws');
	assert.equal(nameWords('Python 3.12.4 (Venv: positron-python)'), '3.12.4 positron-python');
	assert.equal(nameWords('R 4.5.2'), '4.5.2');
});

test('nameWords is null without a version', () => {
	assert.equal(nameWords('(starting, not named yet)'), null);
});

test('firstRow takes the first item of the language, skipping group headings', () => {
	const rows = [
		{ kind: 'group', label: 'R' },
		{ kind: 'item', label: 'Python 3.10.12 (uv: ws)' },
		{ kind: 'item', label: 'R 4.5.2' },
		{ kind: 'item', label: 'R 4.4.2' },
	];
	assert.equal(firstRow(rows, 'r'), 'R 4.5.2');
	assert.equal(firstRow(rows, 'python'), 'Python 3.10.12 (uv: ws)');
	assert.equal(firstRow([], 'r'), null);
});

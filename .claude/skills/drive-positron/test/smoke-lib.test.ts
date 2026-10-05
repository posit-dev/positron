/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstRow, flagValue, nameWords, selectCases, threwResult } from './smoke-lib.ts';

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

const cs = [{ name: 'a', quick: true }, { name: 'b' }, { name: 'c', quick: true }, { name: 'd' }];

test('selectCases runs every case, or the quick ones', () => {
	assert.deepEqual(selectCases(cs, { quick: false, until: null }).map(c => c.name), ['a', 'b', 'c', 'd']);
	assert.deepEqual(selectCases(cs, { quick: true, until: null }).map(c => c.name), ['a', 'c']);
});

test('selectCases --until stops after the named case, inclusive', () => {
	assert.deepEqual(selectCases(cs, { quick: false, until: 'b' }).map(c => c.name), ['a', 'b']);
	assert.deepEqual(selectCases(cs, { quick: false, until: 'd' }).map(c => c.name), ['a', 'b', 'c', 'd']);
});

test('selectCases throws on an --until name no case has', () => {
	assert.throws(() => selectCases(cs, { quick: false, until: 'nope' }), /no case named "nope"/);
});

test('selectCases --until with --quick needs a quick case', () => {
	assert.throws(() => selectCases(cs, { quick: true, until: 'b' }), /not in the --quick run/);
});

test('flagValue reads a value, null when absent, an error when missing', () => {
	assert.equal(flagValue(['--until', 'x'], '--until'), 'x');
	assert.equal(flagValue(['--quick'], '--until'), null);
	assert.match(String(flagValue(['--until'], '--until')), /--until needs a value/);
	assert.match(String(flagValue(['--until', '--keep'], '--until')), /--until needs a value/);
});

test('threwResult records a failure with the case command', () => {
	assert.deepEqual(threwResult('c', ['x.sh', '--a'], new Error('boom'), 5), { name: 'c', status: 'FAIL', helper: 'x.sh', args: ['--a'], problem: 'threw: boom', ms: 5 });
	assert.equal(threwResult('c', [], 'oops', 1).helper, '');
});

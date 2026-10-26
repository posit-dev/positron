/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { readFixtureState } from './fixture-app.ts';

const dir = mkdtempSync(join(tmpdir(), 'fixture-state-'));
const write = (name: string, text: string) => { const f = join(dir, name); writeFileSync(f, text); return f; };

test('readFixtureState: a missing file is null', () => {
	assert.equal(readFixtureState(join(dir, 'none.json')), null);
});

test('readFixtureState: garbage and truncated files are errors', () => {
	assert.ok(readFixtureState(write('g.json', 'not json')) instanceof Error);
	assert.ok(readFixtureState(write('t.json', '{"cdpPort": 12')) instanceof Error);
	assert.ok(readFixtureState(write('e.json', '')) instanceof Error);
});

test('readFixtureState: the wrong shape is an error', () => {
	for (const text of ['null', '[]', '{}', '{"cdpPort":"1","runDir":"/r"}', '{"cdpPort":1.5,"runDir":"/r"}', '{"cdpPort":0,"runDir":"/r"}', '{"cdpPort":1}', '{"cdpPort":1,"runDir":""}']) {
		assert.ok(readFixtureState(write('s.json', text)) instanceof Error, text);
	}
});

test('readFixtureState: a valid file', () => {
	assert.deepEqual(readFixtureState(write('v.json', '{"cdpPort":9222,"runDir":"/tmp/positron-dev-launch/x"}')), { cdpPort: 9222, runDir: '/tmp/positron-dev-launch/x' });
});

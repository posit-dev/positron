/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import type { Finding } from './finding.ts';
import { isoWeek, knownBugs, pickArea, type Area } from './finder-lib.ts';

const here = dirname(new URL(import.meta.url).pathname);
const areas = (JSON.parse(readFileSync(join(here, 'areas.json'), 'utf8')) as { areas: Area[] }).areas;

test('every helper is in exactly one area', () => {
	const sh = readdirSync(join(here, '../scripts')).filter(f => f.endsWith('.sh')).sort();
	const listed = areas.flatMap(a => a.helpers).sort();
	assert.deepEqual(listed, sh);
});

test('isoWeek', () => {
	assert.equal(isoWeek(new Date('2026-01-01T12:00:00Z')), 1);
	assert.equal(isoWeek(new Date('2026-10-05T12:00:00Z')), 41);
	assert.equal(isoWeek(new Date('2027-01-01T12:00:00Z')), 53);
});

test('pickArea rotates by week', () => {
	assert.equal(pickArea(areas, 41, []).area.name, areas[41 % areas.length].name);
	assert.equal(pickArea(areas, 42, []).area.name, areas[42 % areas.length].name);
});

const f = (helper: string, outcome: Finding['outcome'], at: string): Finding => ({
	id: `smoke-${helper}`, source: 'smoke', case: helper, helper, steps: ['s'], observed: 'o', expected: 'e', outcome,
	reproductions: [{ at, by: 'smoke', result: 'fail', observed: 'o' }, { at, by: 'rerun', result: 'fail', observed: 'o' }],
});

test('the most recent fixed or product smoke finding picks the area', () => {
	const recent = [f('plots.sh', 'fixed', '2026-10-01T00:00:00Z'), f('nb.sh', 'product', '2026-10-03T00:00:00Z'), f('ui.sh', 'flake', '2026-10-04T00:00:00Z')];
	const got = pickArea(areas, 41, recent);
	assert.equal(got.area.name, 'notebooks');
	assert.match(got.why, /nb\.sh/);
});

test('knownBugs: finder product findings filed as an issue, each id once', () => {
	const p = (id: string, extra: Partial<Finding>): Finding => ({ id, source: 'finder', helper: 'palette-run.sh', steps: ['s'], observed: 'the palette did\nnot open', expected: 'e', reproductions: [], outcome: 'product', ...extra });
	assert.deepEqual(knownBugs([p('finder-a', { issue: 16340 }), p('finder-a', { issue: 16340 }), p('finder-b', {}), p('finder-c', { outcome: 'fixed', issue: 1 }), { ...p('smoke-d', { issue: 2 }), source: 'smoke' }]),
		['- finder-a (palette-run.sh, issue #16340): the palette did not open']);
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enoughTries, formatCounts, mainReplayMs, originFromMain } from './main-check.mjs';

const steady = { n: 2, m: 2 };
const step = (n, m, at = 5) => ({ step: at, n, m, saw: 'x' });
const origin = (main, extra = {}) => originFromMain({ main, reproduced: steady, drift: false, hasMainBuild: true, ...extra });

test('1: no main build leaves no label', () => {
	assert.deepEqual(origin({ steps: [step(2, 2)] }, { hasMainBuild: false }), { origin: '', reason: 'no main build', detail: '' });
});

test('2: a finding not replayed leaves no label', () => {
	assert.deepEqual(origin(undefined), { origin: '', reason: 'not replayed', detail: '' });
});

test('3: an ID main does not have is introduced, drift or not', () => {
	assert.equal(origin({ missing: ['quarto.foo'] }).origin, 'introduced');
	assert.equal(origin({ missing: ['quarto.foo'] }, { drift: true }).origin, 'introduced');
});

test('4: could not run never becomes introduced', () => {
	assert.deepEqual(origin({ couldNotRun: 'R did not start' }), { origin: '', reason: 'could not run', detail: 'R did not start' });
	assert.equal(origin({ steps: [] }).reason, 'could not run');
});

test('5: drift leaves no label', () => {
	assert.deepEqual(origin({ steps: [step(2, 2)] }, { drift: true }), { origin: '', reason: 'drift', detail: '' });
	assert.equal(origin({ steps: [step(0, 2)] }, { drift: true }).reason, 'drift');
});

test('6: a failing step that also fails on main is inherited', () => {
	assert.deepEqual(origin({ steps: [step(2, 2)] }), { origin: 'inherited', reason: '', detail: '' });
});

test('7: no failing step on main, with enough tries, is introduced', () => {
	assert.deepEqual(origin({ steps: [step(0, 2)] }), { origin: 'introduced', reason: '', detail: '' });
});

test('8: no failing step on main, with too few tries, leaves no label', () => {
	assert.deepEqual(origin({ steps: [step(0, 1)] }), { origin: '', reason: 'too few tries', detail: 'not seen in 1 tries on main' });
});

test('a split from the #16225 replay is inherited', () => {
	const main = { steps: [{ step: 5, n: 0, m: 1, saw: 'chunks stay leaves' }, { step: 9, n: 1, m: 1, saw: 'collapsed' }] };
	assert.equal(originFromMain({ main, reproduced: { n: 1, m: 1 }, drift: false, hasMainBuild: true }).origin, 'inherited');
});

test('a flaky finding needs twice the tries', () => {
	const flaky = { n: 1, m: 4 };
	assert.equal(originFromMain({ main: { steps: [step(0, 4)] }, reproduced: flaky, drift: false, hasMainBuild: true }).reason, 'too few tries');
	assert.equal(originFromMain({ main: { steps: [step(0, 8)] }, reproduced: flaky, drift: false, hasMainBuild: true }).origin, 'introduced');
	assert.equal(enoughTries(flaky, 7), false);
	assert.equal(enoughTries(flaky, 8), true);
});

test('a steady finding needs as many tries', () => {
	assert.equal(origin({ steps: [step(0, 1)] }).reason, 'too few tries');
	assert.equal(origin({ steps: [step(0, 2)] }).origin, 'introduced');
	assert.equal(enoughTries({ n: 1, m: 2 }, 2), true, 'a rate of exactly 1/2 is not under 1/2');
});

test('the fewest tries on any step decide', () => {
	assert.equal(origin({ steps: [step(0, 3, 5), step(0, 1, 9)] }).reason, 'too few tries');
});

test('formatCounts lists steps in order', () => {
	assert.equal(formatCounts({ steps: [step(2, 2, 9), step(0, 2, 5)] }), 'step 5 0/2, step 9 2/2');
	assert.equal(formatCounts({ missing: ['x'] }), '');
});

test('mainReplayMs sums only -main sessions', () => {
	const log = [
		'2026-10-30T12:00:00Z click.sh -s=ex: Run',
		'2026-10-30T12:01:00Z launch.sh -s=ex-main: start',
		'2026-10-30T12:03:00Z click.sh -s=ex-main: Run',
		'2026-10-30T12:04:00Z click.sh -s=ex: Run',
		'2026-10-30T12:05:00Z click.sh -s=ex-main: Run',
		'2026-10-30T12:05:30Z click.sh -s=ex-main: Stop',
	].join('\n');
	assert.equal(mainReplayMs(log), 2 * 60_000 + 30_000);
	assert.equal(mainReplayMs(''), 0);
});

test('an unchecked drift blocks only Introduced: Main stays Main', () => {
	assert.deepEqual(origin({ steps: [step(0, 2)] }, { drift: 'unchecked' }), { origin: '', reason: 'drift unchecked', detail: '' });
	assert.equal(origin({ steps: [step(2, 2)] }, { drift: 'unchecked' }).origin, 'inherited');
	assert.equal(origin({ missing: ['x'] }, { drift: 'unchecked' }).origin, 'introduced');
	assert.equal(origin({ steps: [step(2, 2)] }, { drift: 'drift' }).reason, 'drift');
});

test('a rate with no tries is never enough', () => {
	assert.equal(enoughTries({ n: 0, m: 0 }, 0), false);
	assert.equal(origin({ steps: [step(0, 3)] }, { reproduced: { n: 0, m: 0 } }).reason, 'too few tries');
});

test('a check that fails differently on main is not Also in latest build', () => {
	assert.deepEqual(origin({ steps: [{ step: 5, n: 2, m: 2, saw: 'x', same: false }] }), { origin: '', reason: 'fails differently', detail: '' });
	assert.equal(origin({ steps: [{ step: 5, n: 2, m: 2, saw: 'x', same: false }, { step: 9, n: 1, m: 2, saw: 'y', same: true }] }).origin, 'inherited');
});

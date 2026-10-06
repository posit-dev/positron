/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CaseResult, SmokeResults } from '../test/smoke-lib.ts';
import { cascade, classify, lastFailedPerGroup, mergeResults, smokeFinding, wholesale } from './rerun-lib.ts';

const c = (name: string, status: CaseResult['status'], problem = '', group?: string): CaseResult => ({ name, status, helper: 'x.sh', args: ['--a', 'b'], problem, ms: 1, ...(group ? { group } : {}) });
const r = (cases: CaseResult[], launch: 'PASS' | 'FAIL' = 'PASS'): SmokeResults => ({ startedAt: '2026-10-06T03:40:00Z', until: null, quick: false, launch, launchProblem: '', cases });

test('lastFailedPerGroup is the last FAIL of each group; KNOWN does not count', () => {
	assert.deepEqual(lastFailedPerGroup(r([c('a', 'FAIL'), c('b', 'PASS'), c('c', 'FAIL'), c('d', 'KNOWN')])), ['c']);
	assert.deepEqual(lastFailedPerGroup(r([c('a', 'PASS'), c('b', 'KNOWN')])), []);
	assert.deepEqual(lastFailedPerGroup(r([c('a', 'FAIL', '', 'one'), c('b', 'FAIL', '', 'one'), c('c', 'PASS', '', 'two'), c('d', 'FAIL', '', 'three')])), ['b', 'd']);
});

test('mergeResults keeps every case, and a launch failure from any run', () => {
	const m = mergeResults([r([c('a', 'FAIL')]), { ...r([], 'FAIL'), launchProblem: 'no app' }]);
	assert.deepEqual([m.launch, m.launchProblem, m.cases.map(x => x.name)], ['FAIL', 'no app', ['a']]);
	assert.equal(mergeResults([r([c('a', 'PASS')]), r([c('b', 'PASS')])]).launch, 'PASS');
});

test('classify: fail twice is persistent, pass on the rerun is a flake', () => {
	const got = classify(r([c('a', 'FAIL', 'p1'), c('b', 'FAIL'), c('c', 'PASS')]), r([c('a', 'FAIL', 'p2'), c('b', 'PASS')]));
	assert.deepEqual(got.persistent.map(p => p.first.name), ['a']);
	assert.deepEqual(got.flakes.map(f => f.name), ['b']);
	assert.deepEqual(got.unconfirmed, []);
});

test('classify: a case the rerun never reached is unconfirmed, not a flake', () => {
	const got = classify(r([c('a', 'FAIL'), c('z', 'FAIL')]), r([c('a', 'FAIL')]));
	assert.deepEqual(got.unconfirmed.map(u => u.name), ['z']);
	assert.deepEqual(got.flakes, []);
});

test('smokeFinding records both runs and how to reach the case', () => {
	const f = smokeFinding(c('start-session r', 'FAIL', 'p1'), c('start-session r', 'FAIL', 'p2'), { first: 't1', second: 't2' });
	assert.equal(f.id, 'smoke-start-session-r');
	assert.equal(f.case, 'start-session r');
	assert.deepEqual(f.steps, ['node .claude/skills/drive-positron/test/smoke.ts --until "start-session r"', 'x.sh --a b']);
	assert.deepEqual(f.reproductions.map(x => [x.by, x.result, x.observed]), [['smoke', 'fail', 'p1'], ['rerun', 'fail', 'p2']]);
});

test('wholesale is more than a quarter of the cases', () => {
	assert.equal(wholesale(56, 224), false);
	assert.equal(wholesale(57, 224), true);
	assert.equal(wholesale(0, 0), false);
});

test('cascade resolves open smoke findings whose case now passes', () => {
	const a = smokeFinding(c('a', 'FAIL'), c('a', 'FAIL'), { first: 't', second: 't' });
	const b = smokeFinding(c('b', 'FAIL'), c('b', 'FAIL'), { first: 't', second: 't' });
	const d = { ...smokeFinding(c('d', 'FAIL'), c('d', 'FAIL'), { first: 't', second: 't' }), outcome: 'product' as const };
	const out = cascade([a, b, d], r([c('a', 'PASS'), c('b', 'FAIL'), c('d', 'PASS')]), 'smoke-x', 't3');
	assert.equal(out.find(f => f.id === 'smoke-a')!.outcome, 'resolved');
	assert.equal(out.find(f => f.id === 'smoke-a')!.resolvedBy, 'smoke-x');
	assert.equal(out.find(f => f.id === 'smoke-b')!.outcome, undefined);
	assert.equal(out.find(f => f.id === 'smoke-d')!.outcome, 'product');
});

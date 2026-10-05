/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CaseResult, SmokeResults } from '../test/smoke-lib.ts';
import type { Finding } from './finding.ts';
import { queue, readOutcome, regressions } from './fix-lib.ts';

const f = (id: string, source: Finding['source'], kase?: string, outcome?: Finding['outcome']): Finding => ({
	id, source, case: kase, helper: 'x.sh', steps: ['s'], observed: 'o', expected: 'e', outcome,
	reproductions: [{ at: 't', by: 'smoke', result: 'fail', observed: 'o' }, { at: 't', by: 'rerun', result: 'fail', observed: 'o' }],
});

test('queue: open smoke findings in smoke order, then finder ones, capped', () => {
	const all = [f('finder-z', 'finder'), f('smoke-b', 'smoke', 'b'), f('smoke-a', 'smoke', 'a'), f('smoke-c', 'smoke', 'c', 'resolved')];
	const got = queue(all, ['a', 'b', 'c'], 2);
	assert.deepEqual(got.attempt.map(x => x.id), ['smoke-a', 'smoke-b']);
	assert.deepEqual(got.notAttempted.map(x => x.id), ['finder-z']);
});

const c = (name: string, status: CaseResult['status'], problem = ''): CaseResult => ({ name, status, helper: 'x.sh', args: [], problem, ms: 1 });
const r = (cases: CaseResult[]): SmokeResults => ({ startedAt: 't', until: null, quick: false, launch: 'PASS', launchProblem: '', cases });

test('regressions: passed before, failed after; missing after counts too', () => {
	const got = regressions(r([c('a', 'PASS'), c('b', 'FAIL'), c('d', 'PASS')]), r([c('a', 'FAIL', 'boom'), c('b', 'FAIL')]));
	assert.deepEqual(got.map(x => [x.name, x.problem]), [['a', 'boom'], ['d', 'not reached']]);
});

test('readOutcome accepts the three outcomes with a reason and a reproduction', () => {
	const ok = readOutcome(JSON.stringify({ outcome: 'fixed', reason: 'selector renamed', reproduction: { at: 't', by: 'fixer', result: 'fail', observed: 'o' } }));
	assert.equal(typeof ok === 'object' && ok.outcome, 'fixed');
});

test('readOutcome explains what is unusable', () => {
	assert.match(readOutcome(null) as string, /no outcome file/);
	assert.match(readOutcome('not json') as string, /not JSON/);
	assert.match(readOutcome(JSON.stringify({ outcome: 'resolved', reason: 'r', reproduction: {} })) as string, /outcome/);
	assert.match(readOutcome(JSON.stringify({ outcome: 'flake', reason: '', reproduction: { at: 't', by: 'fixer', result: 'pass', observed: 'o' } })) as string, /reason/);
});

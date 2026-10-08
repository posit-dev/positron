/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CaseResult, SmokeResults } from '../test/smoke-lib.ts';
import type { Finding } from './finding.ts';
import { addedCases, applyCovers, caseGate, earlierVerdicts, fixedBefore, newCaseProblems, newCheckFailures, otherOpen, parseChecks, placeSections, queue, readOutcome, readReview, regressions, sameFinding } from './fix-lib.ts';

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
	assert.deepEqual(typeof ok === 'object' && ok.plain, {});
});

test('readOutcome keeps the plain fields that are non-empty strings', () => {
	const ok = readOutcome(JSON.stringify({ outcome: 'fixed', reason: 'r', reproduction: { at: 't', by: 'fixer', result: 'fail', observed: 'o' }, broke: ' it broke ', cause: '', change: 3 }));
	assert.deepEqual(typeof ok === 'object' && ok.plain, { broke: 'it broke' });
});

test('fixedBefore names the earlier runs that kept a fix, newest first', () => {
	const f = (id: string, extra: Partial<Finding>): Finding => ({ id, source: 'smoke', case: id, helper: 'x.sh', steps: ['s'], observed: 'o', expected: 'e', reproductions: [], ...extra });
	const runs = new Map([['9', [f('a', { outcome: 'fixed', commit: 'c' })]], ['12', [f('a', { outcome: 'fixed', commit: 'c' })]], ['10', [f('a', { outcome: 'fixed', commit: 'c', rejected: 'r' })]], ['11', [f('a', { outcome: 'flake' }), f('b', { outcome: 'fixed', commit: 'c' })]]]);
	assert.deepEqual(fixedBefore(runs, f('a', {})), ['12', '9']);
	assert.deepEqual(fixedBefore(runs, f('z', {})), []);
});

test('readOutcome explains what is unusable', () => {
	assert.match(readOutcome(null) as string, /no outcome file/);
	assert.match(readOutcome('not json') as string, /not JSON/);
	assert.match(readOutcome(JSON.stringify({ outcome: 'resolved', reason: 'r', reproduction: {} })) as string, /outcome/);
	assert.match(readOutcome(JSON.stringify({ outcome: 'flake', reason: '', reproduction: { at: 't', by: 'fixer', result: 'pass', observed: 'o' } })) as string, /reason/);
});

test('earlierVerdicts: newest run first, only this id, resolved and open skipped, capped', () => {
	const v = (outcome?: Finding['outcome'], reason = '') => ({ ...f('smoke-a', 'smoke', 'a', outcome), reason });
	const runs = new Map([
		['9', [v('product', 'upstream')]],
		['10', [v('fixed', 'helper'), f('smoke-b', 'smoke', 'b', 'flake')]],
		['8', [v('resolved')]],
		['7', [v()]],
		['6', [{ ...v('fixed', 'old'), rejected: 'check.ts failed' }]],
	]);
	assert.deepEqual(earlierVerdicts(runs, f('smoke-a', 'smoke', 'a')), ['run 10: fixed: helper', 'run 9: product: upstream', 'run 6: fixed (rejected: check.ts failed): old']);
	assert.deepEqual(earlierVerdicts(runs, f('smoke-a', 'smoke', 'a'), 1), ['run 10: fixed: helper']);
	assert.deepEqual(earlierVerdicts(runs, f('smoke-z', 'smoke', 'z')), []);
});

const CHECK_OUT = 'PASS lint        12 ms\nFAIL drift      40 ms  1 problem(s)\n     FAIL inside a problem line\nPASS unit      900 ms\n1 check(s) failed\n';

test('parseChecks reads the PASS|FAIL line of each check, not the indented problems', () => {
	assert.deepEqual([...parseChecks(CHECK_OUT)], [['lint', 'PASS'], ['drift', 'FAIL'], ['unit', 'PASS']]);
	assert.equal(parseChecks('node: crashed').size, 0);
});

test('newCheckFailures ignores what was red before, and counts a check that vanished', () => {
	const before = parseChecks(CHECK_OUT);
	assert.deepEqual(newCheckFailures(before, before), []);
	assert.deepEqual(newCheckFailures(before, parseChecks('PASS lint 1 ms\nFAIL drift 1 ms\nFAIL unit 1 ms\nFAIL extra 1 ms\n')), ['unit', 'extra']);
	assert.deepEqual(newCheckFailures(before, parseChecks('FAIL drift 1 ms\n')), ['lint', 'unit']);
});

const SMOKE_DIFF_ADD = [
	'diff --git a/.claude/skills/drive-positron/test/smoke.ts b/.claude/skills/drive-positron/test/smoke.ts',
	'--- a/.claude/skills/drive-positron/test/smoke.ts',
	'+++ b/.claude/skills/drive-positron/test/smoke.ts',
	'@@ -310,0 +311,2 @@',
	"+\t{ name: 'terminal-run unknown flag', run: ['terminal-run.sh', '--keys', 'x'], fail: true },",
	"+\t{ name: 'terminal-run bad --index', run: () => ['terminal-run.sh', '--index', 'abc', 'ls'], fail: true, check: o => includes(o.json!.error, '--index') },",
].join('\n');

test('addedCases: an additions-only smoke.ts diff gives each case and its helper', () => {
	assert.deepEqual(addedCases(SMOKE_DIFF_ADD), [
		{ name: 'terminal-run unknown flag', helper: 'terminal-run.sh' },
		{ name: 'terminal-run bad --index', helper: 'terminal-run.sh' },
	]);
});

test('addedCases: a removed or changed line, or a non-case line, gives null', () => {
	assert.equal(addedCases(`${SMOKE_DIFF_ADD}\n-\t{ name: 'old', run: ['x.sh'] },`), null);
	assert.equal(addedCases('@@ -1,0 +1 @@\n+const found = {};'), null);
});

test('addedCases: an added comment line is not a change to smoke', () => {
	assert.deepEqual(addedCases("@@ -1,0 +1,2 @@\n+\t// why the case exists\n+\t{ name: 'x', run: ['ui.sh', 'click'] },"), [{ name: 'x', helper: 'ui.sh' }]);
	assert.deepEqual(addedCases('@@ -1,0 +1 @@\n+\t// only a comment'), []);
});

test('addedCases: an escaped quote in the name is kept', () => {
	assert.deepEqual(addedCases("@@ -1,0 +1 @@\n+\t{ name: 'ui.sh can\\'t find it', run: ['ui.sh', 'x'], fail: true },"), [{ name: "ui.sh can't find it", helper: 'ui.sh' }]);
	assert.deepEqual(addedCases("@@ -1,0 +1 @@\n+\t{ name: 'ui.sh a\\\\b', run: ['ui.sh', 'x'] },"), [{ name: 'ui.sh a\\b', helper: 'ui.sh' }]);
});

const P = '.claude/skills/drive-positron/';
test('caseGate: a helper change needs an added case or an untestable reason', () => {
	assert.equal(caseGate([`${P}scripts/dp-lib.ts`], [], undefined), 'it changes a helper but adds no smoke case');
	assert.equal(caseGate([`${P}scripts/dp-lib.ts`], [{ name: 'a', helper: 'x.sh' }], undefined), '');
	assert.equal(caseGate([`${P}scripts/dp-lib.ts`], [], 'Linux-only keystroke; smoke runs on macOS too'), '');
	assert.equal(caseGate([`${P}SKILL.md`], [], undefined), '');
});

test('caseGate: a smoke.ts edit that is not additions-only passes the gate (it is flagged as a check change instead)', () => {
	assert.equal(caseGate([`${P}scripts/dp-lib.ts`, `${P}test/smoke.ts`], null, undefined), '');
});

test('newCaseProblems: each added case must have run and passed', () => {
	const after = r([c('a', 'PASS'), c('b', 'FAIL', 'exit 0, expected a failure')]);
	assert.deepEqual(newCaseProblems([{ name: 'a', helper: 'x.sh' }, { name: 'b', helper: 'x.sh' }, { name: 'z', helper: 'x.sh' }], after), [
		'its new case "b" fails: exit 0, expected a failure',
		'its new case "z" did not run',
	]);
});

test('readOutcome: keeps an untestable reason', () => {
	const o = readOutcome(JSON.stringify({ outcome: 'fixed', reason: 'r', reproduction: { result: 'fail', observed: 'o' }, untestable: 'only on Linux' }));
	assert.ok(typeof o !== 'string');
	assert.equal(o.untestable, 'only on Linux');
});

test('otherOpen: one line per other open finding, capped ones included', () => {
	const fs = [f('smoke-a', 'smoke', 'a'), f('finder-b', 'finder'), f('smoke-c', 'smoke', 'c', 'resolved'), { ...f('finder-d', 'finder'), notAttempted: 'cap' }];
	assert.deepEqual(otherOpen(fs, 'smoke-a'), ['- finder-b (x.sh): o', '- finder-d (x.sh): o']);
});

test('applyCovers: resolves covered open finder findings only', () => {
	const fs = [f('smoke-a', 'smoke', 'a', 'fixed'), f('finder-b', 'finder'), f('smoke-c', 'smoke', 'c'), f('finder-d', 'finder', undefined, 'product')];
	const got = applyCovers(fs, 'smoke-a', ['finder-b', 'smoke-c', 'finder-d', 'smoke-a', 'nope'], 't');
	assert.equal(got[1].outcome, 'resolved');
	assert.equal(got[1].resolvedBy, 'smoke-a');
	assert.equal(got[1].reproductions.at(-1)!.by, 'fixer');
	assert.equal(got[2].outcome, undefined, 'a smoke finding waits for its case');
	assert.equal(got[3].outcome, 'product', 'a decided finding is left alone');
});

test('readOutcome: keeps covers as a list of strings and drops anything else', () => {
	const o = readOutcome(JSON.stringify({ outcome: 'fixed', reason: 'r', reproduction: { result: 'fail', observed: 'o' }, covers: ['finder-b', 3, ''] }));
	assert.ok(typeof o !== 'string');
	assert.deepEqual(o.covers, ['finder-b']);
});

test('sameFinding: same id, or the same smoke case under another id', () => {
	assert.equal(sameFinding(f('smoke-a', 'smoke', 'a'), f('smoke-a', 'smoke', 'a')), true);
	assert.equal(sameFinding(f('smoke-a', 'smoke', 'a'), f('smoke-a2', 'smoke', 'a')), true);
	assert.equal(sameFinding(f('finder-x', 'finder'), f('finder-y', 'finder')), false);
});

test('earlierVerdicts: a finder finding gets same-helper verdicts, labeled, after exact ones', () => {
	const runs = new Map([
		['10', [{ ...f('finder-old-slug', 'finder', undefined, 'fixed'), reason: 'unknown flag accepted' }]],
		['11', [{ ...f('finder-now', 'finder', undefined, 'flake'), reason: 'could not repro' }]],
	]);
	const got = earlierVerdicts(runs, f('finder-now', 'finder'));
	assert.deepEqual(got, ['run 11: flake: could not repro', 'run 10 (related, same helper x.sh): fixed: unknown flag accepted']);
});

test('fixedBefore: matches a smoke finding by case, not a finder finding by helper', () => {
	const runs = new Map([
		['10', [{ ...f('smoke-a-old', 'smoke', 'a', 'fixed'), commit: 'c' }, { ...f('finder-z', 'finder', undefined, 'fixed'), commit: 'c' }]],
	]);
	assert.deepEqual(fixedBefore(runs, f('smoke-a', 'smoke', 'a')), ['10']);
	assert.deepEqual(fixedBefore(runs, f('finder-q', 'finder')), []);
});

test('readReview: the last JSON object in the final text', () => {
	const text = 'Looked at dp-lib.ts.\n\n```json\n{"verdict":"revise","notes":["dp-terminal.ts:127 still calls parse() without switches"]}\n```';
	assert.deepEqual(readReview(text), { verdict: 'revise', notes: ['dp-terminal.ts:127 still calls parse() without switches'] });
});

test('readReview: approve with no notes', () => {
	assert.deepEqual(readReview('{"verdict":"approve","notes":[]}'), { verdict: 'approve', notes: [] });
});

test('readReview: no JSON, bad JSON, or an unknown verdict is a problem string, not a throw', () => {
	assert.equal(readReview(null), 'the reviewer wrote no final text');
	assert.match(readReview('looks fine to me') as string, /no JSON/);
	assert.match(readReview('{"verdict":"maybe","notes":[]}') as string, /verdict "maybe"/);
	assert.match(readReview('{"verdict":"revise"') as string, /no JSON/);
});

test('readReview: braces in the notes or in prose after the JSON', () => {
	assert.deepEqual(readReview('{"verdict":"revise","notes":["use {} here"]}\nSee `{ x }` above.'), { verdict: 'revise', notes: ['use {} here'] });
});

test('readReview: notes that are not strings are dropped; revise with no notes is approve', () => {
	assert.deepEqual(readReview('{"verdict":"revise","notes":[1,"","real"]}'), { verdict: 'revise', notes: ['real'] });
	assert.deepEqual(readReview('{"verdict":"revise","notes":[]}'), { verdict: 'approve', notes: [] });
});

test('placeSections: each section runs through its committed last case, and added cases bring their sections', () => {
	const listed = [{ name: 'a1', group: 'a' }, { name: 'a2', group: 'a' }, { name: 'a-new', group: 'a' }, { name: 'b1', group: 'b' }, { name: 'b-new', group: 'b' }, { name: 'c1', group: 'c' }];
	const added = [{ name: 'a-new', helper: 'x.sh' }, { name: 'b-new', helper: 'y.sh' }];
	assert.deepEqual(placeSections([{ id: 'a', last: 'a2' }, { id: 'c', last: 'c1' }], listed, added), [{ id: 'a', last: 'a-new' }, { id: 'b', last: 'b-new' }, { id: 'c', last: 'c1' }]);
	assert.deepEqual(placeSections([{ id: 'c', last: 'c1' }], listed, [{ name: 'gone', helper: 'x.sh' }]), [{ id: 'c', last: 'c1' }]);
});

test('readOutcome keeps the fixer\'s account of a changed check', () => {
	const ok = readOutcome(JSON.stringify({ outcome: 'fixed', reason: 'r', reproduction: { at: 't', by: 'fixer', result: 'fail', observed: 'o' }, checks: ' check.ts gains args ' }));
	assert.deepEqual(typeof ok === 'object' && ok.plain, { checks: 'check.ts gains args' });
});

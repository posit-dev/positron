/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Finding } from './finding.ts';
import { counts, loadNight, prBody, prTitle, shouldNotify, slackText, summaryMarkdown, totalCost, type Night } from './report.ts';

const f = (id: string, extra: Partial<Finding> = {}): Finding => ({
	id, source: 'smoke', case: id, helper: 'x.sh', steps: ['s'], observed: `obs ${id}`, expected: 'e',
	reproductions: [{ at: 't', by: 'smoke', result: 'fail', observed: 'first' }, { at: 't', by: 'rerun', result: 'fail', observed: 'second' }], ...extra,
});
const night = (over: Partial<Night> = {}): Night => ({ findings: [], flakes: [], unconfirmed: [], state: {}, smokeRed: false, jobFailed: null, costs: [], smokeDiff: '', ...over });

test('a green night with nothing found sends nothing', () => {
	assert.equal(shouldNotify(night()), false);
	assert.equal(shouldNotify(night({ smokeRed: true })), true);
	assert.equal(shouldNotify(night({ jobFailed: 'Build' })), true);
	assert.equal(shouldNotify(night({ findings: [f('a', { outcome: 'product' })] })), true);
	assert.equal(shouldNotify(night({ problems: ['state.json: bad'] })), true);
});

test('counts, with rejected fixes apart from fixed', () => {
	const n = night({ findings: [f('a', { outcome: 'fixed' }), f('b', { outcome: 'fixed', rejected: 'r' }), f('c', { outcome: 'resolved', resolvedBy: 'a' }), f('d', { outcome: 'product' }), f('e', { notAttempted: 'cap' })], flakes: [{ name: 'z' }] });
	assert.deepEqual(counts(n), { fixed: 1, product: 1, flake: 1, resolved: 1, rejected: 1, notAttempted: 1 });
});

test('notAttempted comes from the findings, not state.notAttempted', () => {
	const n = night({ findings: [f('e', { notAttempted: 'cap' })], state: { notAttempted: [] } });
	assert.equal(counts(n).notAttempted, 1);
	assert.match(summaryMarkdown(n, 'u'), /not attempted: cap/);
});

test('cost splits finder and fixer', () => {
	assert.deepEqual(totalCost([{ label: 'finder-session', usd: 2 }, { label: 'fixer-a', usd: 1.5 }, { label: 'fixer-b', usd: null }]), { finder: 2, fixer: 1.5, total: 3.5 });
});

test('PR body lists each finding with both runs, and leads with smoke checks changed', () => {
	const n = night({ findings: [f('a', { outcome: 'fixed', smokeChecksChanged: true, reason: 'why it changed' }), f('d', { outcome: 'product' })], smokeDiff: '-old\n+new' });
	const body = prBody(n, 'https://run');
	assert.ok(body.startsWith('### Smoke checks changed'));
	assert.match(body, /why it changed/);
	assert.match(body, /```diff\n-old\n\+new\n```/);
	assert.match(body, /first.*second/s);
	assert.match(prTitle(n), /1 helper fix/);
});

test('summary names a wholesale break and a scope violation', () => {
	assert.match(summaryMarkdown(night({ state: { wholesale: true } }), 'u'), /broke wholesale/);
	assert.match(summaryMarkdown(night({ state: { scopeViolation: 'smoke-a: src/x.ts' } }), 'u'), /outside .*src\/x\.ts/);
});

test('slack text has counts, cost, run link and the link', () => {
	const t = slackText(night({ findings: [f('a', { outcome: 'fixed' })], costs: [{ label: 'fixer-a', usd: 1.25 }] }), 'https://run', { kind: 'compare', url: 'https://cmp' });
	assert.match(t, /1 helper fix/);
	assert.match(t, /\$1\.25/);
	assert.match(t, /<https:\/\/run\|run>/);
	assert.match(t, /<https:\/\/cmp\|open the PR>/);
});

test('a missing gate is unknown, never a pass', () => {
	const fixed = [f('a', { outcome: 'fixed' })];
	for (const n of [night({ findings: fixed }), night({ findings: fixed, state: { scopeViolation: 'x' } })]) {
		for (const text of [prBody(n, 'u'), summaryMarkdown(n, 'u'), slackText(n, 'u', null)]) {
			assert.match(text, /Gate: unknown/);
			assert.doesNotMatch(text, /Gate: passed/);
		}
	}
	assert.match(prBody(night({ findings: fixed, state: { gate: 'pass' } }), 'u'), /Gate: passed/);
	assert.match(prBody(night({ findings: fixed, state: { gate: 'fail' } }), 'u'), /Gate: failed/);
});

test('a failed job never reports the gate as passed', () => {
	const n = night({ findings: [f('a', { outcome: 'fixed' })], state: { gate: 'pass' }, jobFailed: 'Fix' });
	for (const text of [prBody(n, 'u'), summaryMarkdown(n, 'u'), slackText(n, 'u', null)]) {
		assert.match(text, /Gate: did not finish/);
		assert.doesNotMatch(text, /Gate: passed/);
	}
});

test('loadNight skips corrupt inputs, names them, and counts a null cost as $0', () => {
	const dir = mkdtempSync(join(tmpdir(), 'report-'));
	for (const d of ['findings', 'cost']) { mkdirSync(join(dir, d)); }
	writeFileSync(join(dir, 'findings', 'a.json'), JSON.stringify(f('a', { outcome: 'fixed' })));
	writeFileSync(join(dir, 'findings', 'b.json'), '{nope');
	writeFileSync(join(dir, 'findings', 'c.json'), '[]');
	writeFileSync(join(dir, 'state.json'), '[1]');
	writeFileSync(join(dir, 'flakes.json'), '{"name":"x"}');
	writeFileSync(join(dir, 'unconfirmed.json'), 'garbage');
	writeFileSync(join(dir, 'cost', 'finder-1.json'), JSON.stringify({ cost: { total_cost_usd: 2 } }));
	writeFileSync(join(dir, 'cost', 'fixer-a.json'), JSON.stringify({ cost: { total_cost_usd: null } }));
	writeFileSync(join(dir, 'cost', 'fixer-b.json'), 'null');
	writeFileSync(join(dir, 'cost', 'fixer-c.json'), '[3]');
	const n = loadNight(dir, false, null);
	assert.deepEqual(n.findings.map(x => x.id), ['a']);
	assert.deepEqual(n.state, {});
	assert.deepEqual(n.flakes, []);
	assert.equal(totalCost(n.costs).total, 2);
	assert.equal(n.problems?.length, 7);
	const text = summaryMarkdown(n, 'u');
	assert.match(text, /Report problems/);
	assert.match(text, /state\.json/);
	assert.match(text, /Gate: unknown/);
	assert.match(text, /had no cost, counted as \$0/);
});

test('loadNight on an empty dir is a quiet green night', () => {
	const n = loadNight(mkdtempSync(join(tmpdir(), 'report-')), false, null);
	assert.equal(shouldNotify(n), false);
});

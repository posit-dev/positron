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
	const t = slackText(night({ findings: [f('a', { outcome: 'fixed' })], costs: [{ label: 'fixer-a', usd: 1.25 }], state: { gate: 'pass' } }), 'https://run', { kind: 'compare', url: 'https://cmp' });
	assert.match(t, /1 helper fixed/);
	assert.match(t, /Review the fix \(linked below\)/);
	assert.doesNotMatch(t, /Slack DM/);
	assert.match(t, /\$1\.25/);
	assert.match(t, /<https:\/\/run\|run>/);
	assert.match(t, /<https:\/\/cmp\|open the PR>/);
});

test('a missing gate never reads as verified', () => {
	const fixed = [f('a', { outcome: 'fixed', commit: 'abc' })];
	for (const n of [night({ findings: fixed }), night({ findings: fixed, state: { scopeViolation: 'x' } })]) {
		for (const text of [prBody(n, 'u'), summaryMarkdown(n, 'u'), slackText(n, 'u', null)]) {
			assert.match(text, /not verified/);
			assert.doesNotMatch(text, /ready to review|pass with it|merge this PR/);
		}
		assert.match(prBody(n, 'u'), /Do not merge the fixes yet: the fix loop did not finish/);
	}
	const pass = prBody(night({ findings: fixed, state: { gate: 'pass' } }), 'u');
	assert.match(pass, /1 helper fixed, ready to review/);
	assert.match(pass, /\*\*To do:\*\* Review and merge this PR\./);
	assert.match(pass, /check\.ts and all of smoke pass with it/);
});

test('a fix checked over some sections says which', () => {
	const fixes = [f('a', { outcome: 'fixed', commit: 'abc', smokeSections: ['terminal'] }), f('b', { outcome: 'fixed', commit: 'def', smokeSections: ['editor', 'debug'] })];
	const text = prBody(night({ findings: fixes, state: { gate: 'pass' } }), 'u');
	assert.match(text, /the smoke terminal section pass with it \(the next nightly runs all of smoke\)/);
	assert.match(text, /the smoke editor, debug sections pass/);
});

test('a finding leads with the fixer\'s plain account and folds the evidence away', () => {
	const a = f('smoke-terminal-run-read', { case: 'terminal-run --read', outcome: 'fixed', commit: 'abc', reason: 'the long reason', broke: 'It cannot read.', cause: 'Alt+F2 goes to the shell.', change: 'It uses the palette.' });
	const text = summaryMarkdown(night({ findings: [a], state: { gate: 'pass' } }), 'u');
	assert.match(text, /^## drive-positron nightly: 1 helper fixed, ready to review/);
	assert.match(text, /### terminal-run --read: fixed\n\n- \*\*What broke:\*\* It cannot read\.\n- \*\*Why:\*\* Alt\+F2 goes to the shell\.\n- \*\*Fix:\*\* It uses the palette\.\n- \*\*Checked:\*\* failed 2 of 2 tries before the fix/);
	assert.ok(text.indexOf('<details>') < text.indexOf('the long reason'));
	assert.match(text, /- smoke, fail: first\n- rerun, fail: second/);
});

test('without the plain account, what broke falls back to the helper and what was seen', () => {
	assert.match(summaryMarkdown(night({ findings: [f('a', { outcome: 'product' })] }), 'u'), /### a: product bug\n\n- \*\*What broke:\*\* x\.sh: obs a\n- \*\*Checked:\*\* failed 2 of 2 tries\./);
});

test('the fallback cuts a helper\'s JSON reply down to its error', () => {
	const a = f('a', { outcome: 'product', observed: 'exit 1: {"ok":false,"error":"the \\"view\\" did not open"}' });
	assert.match(summaryMarkdown(night({ findings: [a] }), 'u'), /What broke:\*\* x\.sh: the "view" did not open\n/);
});

test('a fix that came back says the earlier fixes never landed', () => {
	const text = summaryMarkdown(night({ findings: [f('a', { outcome: 'fixed', commit: 'c', fixedBefore: ['12', '9'] })], state: { gate: 'pass' } }), 'u');
	assert.match(text, /"a" came back after being fixed on earlier nights; those fixes were never merged/);
	assert.match(text, /\*\*Seen before:\*\* fixed on 2 earlier nights too \(run 12, run 9\)/);
});

test('to do names product bugs, and is nothing on a quiet night', () => {
	assert.match(summaryMarkdown(night({ findings: [f('d', { outcome: 'product' })] }), 'u'), /\*\*To do:\*\* Look at the 1 product bug below/);
	assert.match(summaryMarkdown(night(), 'u'), /^## drive-positron nightly: all green\n\n\*\*To do:\*\* nothing\./);
});

test('a failed job never reports the fixes as verified', () => {
	const n = night({ findings: [f('a', { outcome: 'fixed', commit: 'abc' })], state: { gate: 'pass' }, jobFailed: 'Fix' });
	for (const text of [prBody(n, 'u'), summaryMarkdown(n, 'u'), slackText(n, 'u', null)]) {
		assert.match(text, /the job broke/);
		assert.doesNotMatch(text, /ready to review|pass with it/);
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
	assert.match(text, /not verified/);
	assert.match(text, /had no cost, counted as \$0/);
});

test('loadNight on an empty dir is a quiet green night', () => {
	const n = loadNight(mkdtempSync(join(tmpdir(), 'report-')), false, null);
	assert.equal(shouldNotify(n), false);
});

test('PR body stays under the GitHub limit with a huge diff and many findings', () => {
	const many = Array.from({ length: 300 }, (_, i) => f(`f${i}`, { outcome: 'fixed', smokeChecksChanged: true, reason: 'r'.repeat(300), observed: 'o'.repeat(500) }));
	const body = prBody(night({ findings: many, smokeDiff: '+x\n'.repeat(100000) }), 'https://run');
	assert.ok(body.length < 65536, String(body.length));
	assert.match(body, /truncated, see the run/);
	assert.match(body, /And \d+ more, see the run summary/);
});

test('the diff fence outgrows backticks inside the diff', () => {
	const body = prBody(night({ findings: [f('a', { outcome: 'fixed', smokeChecksChanged: true })], smokeDiff: '+```js\n+x\n+```' }), 'u');
	assert.match(body, /````diff\n\+```js/);
});

test('changed smoke checks with a blank diff say so instead of an empty fence', () => {
	const body = prBody(night({ findings: [f('a', { outcome: 'fixed', smokeChecksChanged: true })], smokeDiff: '  \n' }), 'u');
	assert.match(body, /\(diff unavailable\)/);
	assert.doesNotMatch(body, /```diff/);
});

test('slack text escapes mrkdwn and drops empty links', () => {
	const t = slackText(night({ jobFailed: 'A <b> & C' }), '', null);
	assert.match(t, /A &lt;b&gt; &amp; C/);
	assert.doesNotMatch(t, /<\|/);
	assert.doesNotMatch(t, /<b>/);
	assert.match(slackText(night(), 'https://run', { kind: 'pr', url: '' }), /<https:\/\/run\|run>$/);
});

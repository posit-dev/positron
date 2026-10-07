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
import { counts, inert, loadNight, prBody, prTitle, shouldNotify, slackText, summaryMarkdown, totalCost, type Night } from './report.ts';

const f = (id: string, extra: Partial<Finding> = {}): Finding => ({
	id, source: 'smoke', case: id, helper: 'x.sh', steps: ['s'], observed: `obs ${id}`, expected: 'e',
	reproductions: [{ at: 't', by: 'smoke', result: 'fail', observed: 'first' }, { at: 't', by: 'rerun', result: 'fail', observed: 'second' }], ...extra,
});
const night = (over: Partial<Night> = {}): Night => ({ findings: [], flakes: [], unconfirmed: [], state: {}, smokeRed: false, jobFailed: null, costs: [], checksDiff: '', ...over });

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

test('a capped finding that a fix resolved counts as resolved, not also as not attempted', () => {
	const n = night({ findings: [f('a', { outcome: 'fixed' }), f('c', { outcome: 'resolved', resolvedBy: 'a', notAttempted: 'cap' })], state: { gate: 'pass' } });
	assert.equal(counts(n).notAttempted, 0);
	assert.doesNotMatch(summaryMarkdown(n, 'u'), /not attempted/);
	assert.match(summaryMarkdown(n, 'u'), /c: fixed by a/);
});

test('the fixes lead and what they resolved comes last', () => {
	const n = night({ findings: [f('a', { outcome: 'resolved', resolvedBy: 'z' }), f('b', { outcome: 'product' }), f('z', { outcome: 'fixed' })], state: { gate: 'pass' } });
	const body = prBody(n, 'u');
	assert.ok(body.indexOf('#### z') < body.indexOf('#### b') && body.indexOf('#### b') < body.indexOf('#### a'));
});

test('slack folds the findings a fix resolved into its block', () => {
	const rs = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'].map(id => f(id, { outcome: 'resolved', resolvedBy: 'z' }));
	const t = slackText(night({ findings: [...rs, f('z', { outcome: 'fixed', change: 'C' })], state: { gate: 'pass' } }), 'u', null);
	assert.match(t, /^`z`\n\*Broke\* \u00b7 obs z\n\*Fix\* \u00b7 C\n_It also fixes 7 more: r1, r2, r3, r4, r5 and 2 others\._$/m);
	assert.doesNotMatch(t, /`r1`|And \d+ more/);
});

test('cost splits finder and fixer', () => {
	assert.deepEqual(totalCost([{ label: 'finder-session', usd: 2 }, { label: 'fixer-a', usd: 1.5 }, { label: 'fixer-b', usd: null }, { label: 'reviewer-a-1', usd: 0.25 }]), { finder: 2, fixer: 1.5, reviewer: 0.25, total: 3.75 });
});

test('PR body lists each finding with both runs, and leads with checks changed', () => {
	const n = night({ findings: [f('a', { outcome: 'fixed', checksChanged: true, reason: 'why it changed' }), f('d', { outcome: 'product' })], checksDiff: '-old\n+new' });
	const body = prBody(n, 'https://run');
	assert.ok(body.startsWith('### Checks changed'));
	assert.match(body, /why it changed/);
	assert.match(body, /```diff\n-old\n\+new\n```/);
	assert.match(slackText(n, 'u', null), /changes test\/ or heal\//);
	assert.doesNotMatch(slackText(night({ findings: [f('a', { outcome: 'fixed' })] }), 'u', null), /heal\//);
	assert.match(body, /first.*second/s);
	assert.equal(prTitle(n), 'drive-positron: fix x.sh from the nightly run');
});

test('summary names a wholesale break and a scope violation', () => {
	assert.match(summaryMarkdown(night({ state: { wholesale: true } }), 'u'), /broke wholesale/);
	assert.match(summaryMarkdown(night({ state: { scopeViolation: 'smoke-a: src/x.ts' } }), 'u'), /outside .*src\/x\.ts/);
});

test('slack text has the header, a block per finding and the link', () => {
	const fix = f('a', { outcome: 'fixed', broke: 'B', cause: 'W', change: 'C', fixedBefore: ['1', '2'] });
	const t = slackText(night({ findings: [fix, f('p', { outcome: 'product', cause: 'It hides 42.' })], state: { gate: 'pass' } }), 'https://run', { kind: 'pr', url: 'https://gh/pull/12' });
	assert.match(t, /^\*\/drive-positron locator repairs \u00b7 1 fix, 1 product bug\*/);
	assert.match(t, /`a`\n\*Broke\* \u00b7 B\n\*Fix\* \u00b7 C\n_Fixed on 2 earlier nightlies too/);
	assert.match(t, /`p`\n\*Broke\* \u00b7 obs p\n\*Status\* \u00b7 product bug\n\*Why\* \u00b7 It hides 42\./);
	assert.doesNotMatch(t, /\*Why\* \u00b7 W/);
	assert.match(t, /\*To do\* \u00b7 Look at the 1 product bug/);
	assert.doesNotMatch(t, /Review|\$/);
	assert.match(t, /\u2192 <https:\/\/gh\/pull\/12\|review PR #12>$/);
	assert.match(slackText(night({ findings: [fix], state: { gate: 'pass' } }), 'u', { kind: 'compare', url: 'https://cmp' }), /<https:\/\/cmp\|open the PR>$/);
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
	const many = Array.from({ length: 300 }, (_, i) => f(`f${i}`, { outcome: 'fixed', checksChanged: true, reason: 'r'.repeat(300), observed: 'o'.repeat(500) }));
	const body = prBody(night({ findings: many, checksDiff: '+x\n'.repeat(100000) }), 'https://run');
	assert.ok(body.length < 65536, String(body.length));
	assert.match(body, /truncated, see the run/);
	assert.match(body, /And \d+ more, see the run summary/);
});

test('the diff fence outgrows backticks inside the diff', () => {
	const body = prBody(night({ findings: [f('a', { outcome: 'fixed', checksChanged: true })], checksDiff: '+```js\n+x\n+```' }), 'u');
	assert.match(body, /````diff\n\+```js/);
});

test('changed smoke checks with a blank diff say so instead of an empty fence', () => {
	const body = prBody(night({ findings: [f('a', { outcome: 'fixed', checksChanged: true })], checksDiff: '  \n' }), 'u');
	assert.match(body, /\(diff unavailable\)/);
	assert.doesNotMatch(body, /```diff/);
});

test('slack text escapes mrkdwn and drops empty links', () => {
	const t = slackText(night({ jobFailed: 'A <b> & C' }), '', null);
	assert.match(t, /A &lt;b&gt; &amp; C/);
	assert.doesNotMatch(t, /<\|/);
	assert.doesNotMatch(t, /<b>/);
	assert.match(slackText(night(), 'https://run', { kind: 'pr', url: '' }), /<https:\/\/run\|see the run>$/);
});

test('the To do line says when check.ts was red before the fixes and when the fixer time ran out', () => {
	const n = night({ state: { gate: 'none', checksRedOnMain: ['drift'], outOfTime: 2 } });
	assert.match(prBody(n, 'u'), /check\.ts was already failing on main: drift\./);
	assert.match(summaryMarkdown(n, 'u'), /fixer time ran out; 2 findings were left for the next night/);
	assert.match(slackText(n, 'u', null), /already failing on main: drift/);
});

test('a fix\'s Checked line names the checks already red on main', () => {
	const fixed = night({ findings: [f('a', { outcome: 'fixed', commit: 'c' })], state: { gate: 'pass', checksRedOnMain: ['drift'] } });
	assert.match(prBody(fixed, 'u'), /check\.ts \(apart from drift, already failing on main\) and all of smoke pass/);
});

test('inert wraps mentions and issue references in code spans, outside existing ones', () => {
	assert.equal(inert('ask @someone about #123 and posit-dev/positron#9, GH-4'), 'ask `@someone` about `#123` and `posit-dev/positron#9`, `GH-4`');
	assert.equal(inert('`panel.sh @x #1` stays; mail bot@posit.co, C# and a#1 too'), '`panel.sh @x #1` stays; mail bot@posit.co, C# and a#1 too');
	assert.equal(inert('see `cmd and @alice'), "see 'cmd and `@alice`");
	assert.equal(inert('`@skip` and bad` @bob'), "`@skip` and bad' `@bob`");
	const body = prBody(night({ findings: [f('a', { outcome: 'fixed', broke: 'pinged @org/team', cause: 'see #42', change: 'c', reason: 'r @me' })] }), 'u');
	assert.doesNotMatch(body, /[^`]@org\/team|[^`]#42|[^`]@me/);
	for (const wrapped of ['`@org/team`', '`#42`', '`@me`']) { assert.ok(body.includes(wrapped), wrapped); }
});

test('the title names the fixed helpers, at most three', () => {
	const fixed = (id: string, helper: string) => f(id, { helper, outcome: 'fixed' });
	assert.equal(prTitle(night({ findings: [fixed('a', 'a.sh'), fixed('b', 'b.sh'), fixed('c', 'a.sh')] })), 'drive-positron: fix a.sh, b.sh from the nightly run');
	assert.equal(prTitle(night({ findings: ['a', 'b', 'c', 'd', 'e'].map(h => fixed(h, `${h}.sh`)) })), 'drive-positron: fix a.sh, b.sh, c.sh and 2 more helpers from the nightly run');
	assert.equal(prTitle(night({ findings: [f('a', { outcome: 'fixed', rejected: 'r' })] })), 'drive-positron: helper fixes from the nightly run');
});

test('What broke: invalid JSON in observed is shown cut, not stopped at its stray quote', () => {
	const observed = '{"ok":false,"error":"/tmp/heal/q"x" is not a venv"}';
	const body = summaryMarkdown(night({ findings: [f('a', { source: 'finder', case: undefined, helper: 'run-venv.sh', observed })] }), 'u');
	assert.match(body, /What broke:\*\* run-venv\.sh: \{"ok":false/);
	assert.doesNotMatch(body, /What broke:\*\* run-venv\.sh: \/tmp\/heal\/q\n/);
});

test('a kept fix shows its review notes, its revision, and why it has no smoke case', () => {
	const n = night({ findings: [f('a', { outcome: 'fixed', review: ['dp-x.ts:3 has the same bug'], revised: true, untestable: 'Linux only' })], state: { gate: 'pass' } });
	const body = prBody(n, 'u');
	assert.match(body, /\*\*Review:\*\* sent back once; after the revision: dp-x\.ts:3 has the same bug/);
	assert.match(body, /\*\*No smoke case:\*\* Linux only/);
});

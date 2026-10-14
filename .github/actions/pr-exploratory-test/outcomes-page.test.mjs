/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderOutcomesPage, splitEvidence, summarize } from './outcomes-page.mjs';

const row = (outcome, extra = {}) => ({
	pr: 1, run: '10', finding: 1, title: 'A finding', severity: 'minor', trigger: 'explore', decidedBy: 'diff+model',
	reportUrl: 'https://example.com/r/index.html', skillVersion: '1.9', model: 'opus', outcome, evidence: '', paths: [], ...extra,
});
const NOW = new Date('2026-10-13T12:00:00Z');
const render = rows => renderOutcomesPage(rows, { now: NOW });
// Visible text only, with tags dropped and entities that matter here undone.
const text = html => html.replace(/<(script|style)[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, ' ').replace(/&middot;/g, '~').replace(/&#39;/g, '\'').replace(/\s+/g, ' ');
const today = [...Array(8)].map(() => row('fixed-in-pr')).concat(row('fixed-later'), [...Array(7)].map(() => row('pending', { decidedBy: 'window' })));

test('summarize counts checked, fixed and can\'t-check-yet, after dropping duplicates', () => {
	const s = summarize([
		row('fixed-in-pr'), row('fixed-in-pr'), row('fixed-later'), row('not-acted-on'),
		row('pending'), row('unclear'), row('no-paths'), row('fixed-in-pr', { dupOf: '9#1' }),
	]);
	assert.equal(s.total, 7);
	assert.equal(s.fixed, 3);
	assert.equal(s.checked, 4);
	assert.equal(s.open, 3);
	assert.equal(s.dups, 1);
	assert.equal(s.counts['fixed-in-pr'], 2);
});

test('the headline gives the fix rate and the share fixed in the PR, as in the handoff', () => {
	const t = text(render(today));
	assert.match(t, /100% of findings we could check get fixed, 89% before the PR even merges\./);
	assert.match(t, /9 of 9 checked findings fixed, out of 16 total; 7 pending\. Duplicates of earlier runs are left out\./);
});

test('with nothing checked the rates read n/a and the CHECKED bracket is left out', () => {
	const html = render([row('pending'), row('unclear')]);
	assert.match(text(html), /n\/a of findings we could check get fixed, n\/a before/);
	assert.doesNotMatch(html, /class="bracket checked"/);
	assert.match(text(html), /Checked so far 0% 0 of 2/);
});

test('the footnote names only the parts that are not zero, and counts duplicates left out', () => {
	const t = text(render([row('fixed-in-pr'), row('unclear'), row('fixed-in-pr', { run: '11', dupOf: '10#1' })]));
	assert.match(t, /1 of 1 checked findings fixed, out of 2 total; 1 unclear\. 1 duplicates of earlier runs left out\./);
});

test('the cards give fixed with its split, not acted on, and the share checked', () => {
	const t = text(render(today));
	assert.match(t, /Issues fixed 9 8 in the PR ~ 1 later All were Minor this period\./);
	assert.match(t, /Not acted on 0 findings Every finding we could check was acted on\. None were left as is\./);
	assert.match(t, /Checked so far 56% 9 of 16 The fix rate is based on these\. The rest: 7 pending\./);
	assert.match(text(render([row('fixed-in-pr', { severity: 'major' }), row('not-acted-on')])), /1 of them were Moderate or Major, real bugs, not just polish\.[\s\S]*1 of 2 checked findings were left as is\./);
});

test('the bar has one segment per outcome present, in palette order, and the legend keeps zeros', () => {
	const html = render([row('pending'), row('fixed-later'), row('fixed-in-pr'), row('fixed-in-pr')]);
	const bar = html.match(/<div class="bar big">([\s\S]*?)<\/div>/)[1];
	assert.deepEqual([...bar.matchAll(/class="seg o-([a-z-]+)"/g)].map(m => m[1]), ['fixed-in-pr', 'fixed-later', 'pending']);
	assert.match(bar, /data-filter="fixed"[^>]*style="width:50%"[^>]*>2<span>Fixed in the PR<\/span>/);
	assert.match(text(html), /CHECKED 3 ~ all fixed CAN'T CHECK YET 1/i);
	assert.match(text(html), /Not acted on 0/);
	assert.match(text(html), /No files named 0/);
});

test('severity rows always show Major, Moderate and Minor, with an empty box for none', () => {
	const t = text(render([row('fixed-in-pr', { severity: 'moderate' }), row('pending', { severity: 'moderate' })]));
	assert.match(t, /Major n\/a 0 findings No Major findings in this period/);
	assert.match(t, /Moderate 100% 1 of 1 we could check .*1 of 2 fixed overall ~ 1 can't check yet/);
	assert.match(t, /No Minor findings in this period/);
});

test('PRs are listed with the most findings first', () => {
	const html = render([row('fixed-in-pr', { pr: 5 }), row('pending', { pr: 7 }), row('pending', { pr: 7, finding: 2 })]);
	const by = html.slice(html.indexOf('id="pr-h"'));
	assert.ok(by.indexOf('>#7<') < by.indexOf('>#5<'));
	assert.match(text(by), /#7 2 findings .*2 open/);
});

test('splitEvidence takes the source off the front: commits, issue, or none', () => {
	assert.deepEqual(splitEvidence('pr a15cdab1c1,73456c1fcd: fixes it'), { where: 'pr', commits: ['a15cdab1c1', '73456c1fcd'], issue: null, text: 'fixes it' });
	assert.deepEqual(splitEvidence('pr (whole) abc1234: yes'), { where: 'pr', commits: ['abc1234'], issue: null, text: 'yes' });
	assert.deepEqual(splitEvidence('pr (rebased, whole): no change: here'), { where: 'pr', commits: [], issue: null, text: 'no change: here' });
	assert.deepEqual(splitEvidence('main 9abcdef: later'), { where: 'main', commits: ['9abcdef'], issue: null, text: 'later' });
	assert.deepEqual(splitEvidence('issue #16290: same'), { where: 'issue', commits: [], issue: 16290, text: 'same' });
	assert.deepEqual(splitEvidence('the cause names no file'), { where: null, commits: [], issue: null, text: 'the cause names no file' });
});

test('an expanded finding shows its evidence, commits as chips, files, run and links', () => {
	const html = render([row('fixed-in-pr', { pr: 16556, run: '37', finding: 2, paths: ['src/a.ts'], evidence: 'pr abc1234: drops `<b>` now' })]);
	assert.match(html, /<button[^>]*aria-expanded="false"/);
	assert.match(html, /<p class="ev">drops <code>&lt;b&gt;<\/code> now<\/p>/);
	assert.match(html, /<dt>Commits on the PR<\/dt><dd><a class="chip" href="https:\/\/github.com\/posit-dev\/positron\/commit\/abc1234">abc1234<\/a><\/dd>/);
	assert.match(html, /<dt>Files<\/dt><dd><code class="chip">src\/a.ts<\/code><\/dd>/);
	assert.match(text(html), /Decided by The diff, read by the model/);
	assert.match(text(html), /Run 37#2 ~ started by \/explore ~ skill 1\.9 ~ opus/);
	assert.match(html, /<a href="https:\/\/example.com\/r\/index.html">Open report<\/a>/);
	assert.match(html, /<a href="https:\/\/github.com\/posit-dev\/positron\/pull\/16556">Open PR<\/a>/);
});

test('a finding without paths or a source prefix has no Files or Commits line', () => {
	const html = render([row('no-paths', { decidedBy: 'none', evidence: 'the cause names no file' })]);
	assert.doesNotMatch(html, /<dt>Files<\/dt>/);
	assert.doesNotMatch(html, /<dt>Commits/);
});

test('a possible duplicate is counted and tagged; a sure duplicate appears nowhere', () => {
	const html = render([row('fixed-in-pr', { dupMaybe: '9#1' }), row('fixed-in-pr', { title: 'Hidden twin', dupOf: '9#2' })]);
	assert.match(html, /Possible duplicate/);
	assert.ok(!html.includes('Hidden twin'));
	assert.match(text(html), /All 1 findings by outcome/);
});

test('titles are escaped and a report URL that is not http(s) is not linked', () => {
	const html = render([row('pending', { title: '<img src=x onerror=alert(1)>', reportUrl: 'javascript:alert(1)' })]);
	assert.ok(!html.includes('<img src=x'));
	assert.ok(!html.includes('javascript:'));
});

test('the meta line gives the PRs, the dates the findings were posted, and what started the runs', () => {
	const t = text(render([row('fixed-in-pr', { postedAt: '2026-09-22T10:00:00Z' }), row('pending', { pr: 2, trigger: 'auto', postedAt: '2026-10-09T08:00:00Z' })]));
	assert.match(t, /2 PRs ~ 2026-09-22 to 2026-10-09 1 started by \/explore ~ 1 started automatically Generated 2026-10-13/);
});

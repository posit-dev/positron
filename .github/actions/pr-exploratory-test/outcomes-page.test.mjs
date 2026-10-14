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

test('summarize counts resolved, fixed and unresolved, after dropping duplicates', () => {
	const s = summarize([
		row('fixed-in-pr'), row('fixed-in-pr'), row('fixed-later'), row('not-acted-on'),
		row('pending'), row('unclear'), row('no-paths'), row('fixed-in-pr', { dupOf: '9#1' }),
	]);
	assert.equal(s.total, 7);
	assert.equal(s.fixed, 3);
	assert.equal(s.resolved, 4);
	assert.equal(s.unresolved, 3);
	assert.equal(s.dups, 1);
	assert.equal(s.counts['fixed-in-pr'], 2);
});

test('the headline gives the fix rate and the share fixed in the PR, as in the handoff', () => {
	const t = text(render(today));
	assert.match(t, /100% of resolved findings get fixed, 89% before the PR even merges\./);
	assert.match(t, /9 of 9 resolved findings fixed, out of 16 total; 7 pending\. Duplicates of earlier runs are left out\./);
});

test('with nothing resolved the rates read n/a and the RESOLVED bracket is left out', () => {
	const html = render([row('pending'), row('unclear')]);
	assert.match(text(html), /n\/a of resolved findings get fixed, n\/a before/);
	assert.doesNotMatch(html, /class="bracket resolved"/);
	assert.match(text(html), /UNRESOLVED ~ 2/i);
});

test('the footnote names only the parts that are not zero, and counts duplicates left out', () => {
	const t = text(render([row('fixed-in-pr'), row('unclear'), row('fixed-in-pr', { run: '11', dupOf: '10#1' })]));
	assert.match(t, /1 of 1 resolved findings fixed, out of 2 total; 1 unclear\. 1 duplicates of earlier runs left out\./);
});

test('the cards give fixed with its split, PRs changed, and pending', () => {
	const t = text(render(today));
	assert.match(t, /Issues fixed 9 8 in the PR ~ 1 later Problems developers fixed after \/explore flagged them\./);
	assert.match(t, /PRs changed 1 of 1 PR PRs where at least one \/explore finding got fixed\./);
	assert.match(t, /Pending 7 findings PR still open, or merged in the last 60 days\. Each resolves once a fix lands or the 60-day window closes\. Findings by outcome/);
	const two = text(render([row('fixed-in-pr'), row('pending', { pr: 2 }), row('unclear', { pr: 3 }), row('no-paths', { pr: 3 })]));
	assert.match(two, /PRs changed 1 of 3 PRs/);
	assert.match(two, /window closes\. 2 more can't be checked \(unclear or no files named\)\./);
	assert.doesNotMatch(two, /Not acted on 0|Checked so far|Moderate or Major/);
});

test('the bar has one segment per outcome present, in palette order, and so does the legend', () => {
	const html = render([row('pending'), row('fixed-later'), row('fixed-in-pr'), row('fixed-in-pr')]);
	const bar = html.match(/<div class="bar big">([\s\S]*?)<\/div>/)[1];
	assert.deepEqual([...bar.matchAll(/class="seg o-([a-z-]+)"/g)].map(m => m[1]), ['fixed-in-pr', 'fixed-later', 'pending']);
	assert.match(bar, /data-filter="fixed"[^>]*style="width:50%"[^>]*>2<span>Fixed in the PR<\/span>/);
	assert.doesNotMatch(bar, /title=/);
	assert.match(text(html), /Findings by outcome RESOLVED ~ 3 UNRESOLVED ~ 1/i);
	assert.doesNotMatch(html.match(/<div class="brackets">[\s\S]*?<div class="legend-wrap">/)[0], /all fixed|Click a segment|title=/i);
	const legend = html.match(/<div class="legend">([\s\S]*?)<\/div>/)[1];
	assert.deepEqual([...legend.matchAll(/class="o-([a-z-]+)"/g)].map(m => m[1]), ['fixed-in-pr', 'fixed-later', 'pending']);
});

test('each bar segment has a detail line to show in place of the legend on hover or focus', () => {
	const html = render([row('pending'), row('fixed-in-pr'), row('fixed-in-pr'), row('fixed-in-pr')]);
	assert.match(html, /<a class="seg o-fixed-in-pr" [^>]*data-key="fixed-in-pr"/);
	assert.match(text(html.match(/<p class="seg-detail" data-for="fixed-in-pr" hidden>[\s\S]*?<\/p>/)[0]), /Fixed in the PR 3 of 4 \(75%\) A commit pushed to the PR after the run fixed it\./);
	assert.match(html, /<p class="seg-detail" data-for="pending" hidden>/);
});

test('not acted on is dusty blue with dark text', () => {
	assert.match(render([row('not-acted-on')]), /\.o-not-acted-on\{background:#8FA3C0;color:#17191C\}/);
	assert.match(render([row('not-acted-on')]), /a:not\(\.seg\):hover\{/);
});

test('severity rows always show Major, Moderate and Minor, with an empty box for none', () => {
	const t = text(render([row('fixed-in-pr', { severity: 'moderate' }), row('pending', { severity: 'moderate' })]));
	assert.match(t, /Unresolved 1 Expand all/);
	assert.match(t, /Major n\/a 0 findings No Major findings in this period/);
	assert.match(t, /% fixed = fixed \/ resolved findings\. Too few so far to compare severities\..*Moderate 100% 1 of 1 resolved .*1 of 2 fixed overall ~ 1 unresolved/);
	assert.match(t, /No Minor findings in this period/);
	assert.match(text(render([row('pending', { severity: 'major' })])), /Major n\/a none resolved yet/);
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
	assert.match(text(html), /All 1 /);
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

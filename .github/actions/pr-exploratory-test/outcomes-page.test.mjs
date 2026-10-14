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
const NOW = new Date('2026-10-14T12:00:00Z');
const render = rows => renderOutcomesPage(rows, { now: NOW });
// Visible text only, with tags dropped and the entities used here undone.
const text = html => html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, ' ')
	.replace(/&middot;/g, '~').replace(/&ndash;/g, '-').replace(/&divide;/g, '/').replace(/&mdash;/g, '--').replace(/&#39;/g, '\'').replace(/\s+/g, ' ');
const section = (html, id) => html.slice(html.indexOf(`id="${id}"`)).split('</section>')[0];
// Today's data from the handoff: 8 fixed in the PR, 1 fixed later, 7 pending.
const today = [
	...[...Array(4)].map(() => row('fixed-in-pr', { severity: 'moderate' })),
	...[...Array(4)].map(() => row('fixed-in-pr')),
	row('fixed-later'),
	...[...Array(4)].map(() => row('pending', { severity: 'moderate', decidedBy: 'window' })),
	...[...Array(3)].map(() => row('pending', { decidedBy: 'window' })),
];

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

test('the headline counts findings fixed before merging, with no rate', () => {
	const html = render(today);
	assert.match(text(html), /Does \/explore change what ships\? Developers fixed 8 findings before merging\./);
	assert.match(html, /<span class="green">8<\/span>/);
	assert.doesNotMatch(text(html.match(/<p class="headline">[\s\S]*?<\/p>/)[0]), /%|resolved/);
	assert.match(text(render([row('fixed-in-pr')])), /Developers fixed 1 finding before merging\./);
	assert.match(text(render([row('fixed-later')])), /Developers fixed no findings before merging\./);
});

test('the eyebrow gives the date range, with the year once, and triggers only when mixed', () => {
	const one = render([row('fixed-in-pr', { postedAt: '2026-08-18T10:00:00Z' }), row('pending', { postedAt: '2026-10-13T08:00:00Z' })]);
	assert.match(text(one.match(/<div class="eyebrow">[\s\S]*?<\/div>/)[0]), /^ \/explore Aug 18 - Oct 13, 2026 $/);
	assert.match(one, /<time datetime="2026-08-18">Aug 18<\/time>/);
	const mixed = text(render([row('fixed-in-pr', { postedAt: '2025-12-20T10:00:00Z' }), row('pending', { trigger: 'auto', postedAt: '2026-01-05T08:00:00Z' })]));
	assert.match(mixed, /\/explore Dec 20, 2025 - Jan 5, 2026 ~ 1 started by \/explore ~ 1 started automatically/);
});

test('the cards give fixed with its split, PRs changed, and pending', () => {
	const t = text(render(today));
	assert.match(t, /Issues fixed 9 8 in the PR ~ 1 later Problems developers fixed after \/explore flagged them\./);
	assert.match(t, /PRs changed 1 of 1 PR PRs where at least one \/explore finding got fixed\./);
	assert.match(t, /Pending 7 findings PR still open, or merged in the last 30 days\. Each resolves once a fix lands or the 30-day window closes\. Findings by outcome/);
	const two = text(render([row('fixed-in-pr'), row('pending', { pr: 2 }), row('unclear', { pr: 3 }), row('no-paths', { pr: 3 })]));
	assert.match(two, /PRs changed 1 of 3 PRs/);
	assert.match(two, /window closes\. 2 more can't be checked \(unclear or no files named\)\./);
});

test('the header leaves out what the handoff removed', () => {
	const t = text(render(today));
	assert.doesNotMatch(t, /Outcome report|findings across|Resolved so far|known outcome|scored|can't check yet/);
	assert.doesNotMatch(t.slice(0, t.indexOf('Findings by outcome')), /Generated|started by/);
});

test('the bar has one linked segment per outcome present, in palette order, and so does the legend', () => {
	const html = render([row('pending'), row('fixed-later'), row('fixed-in-pr'), row('fixed-in-pr')]);
	const bar = html.match(/<div class="bar big">([\s\S]*?)<\/div>/)[1];
	assert.deepEqual([...bar.matchAll(/class="seg o-([a-z-]+)"/g)].map(m => m[1]), ['fixed-in-pr', 'fixed-later', 'pending']);
	assert.match(bar, /href="#evidence" data-filter="fixed" data-key="fixed-in-pr"[^>]*style="width:50%">2<span>Fixed in the PR<\/span><\/a>/);
	assert.match(bar, /data-key="fixed-later"[^>]*>1<span>Fixed later<\/span>/);
	assert.doesNotMatch(bar, /title=/);
	assert.match(text(section(html, 'all-h')), /Findings by outcome Resolved ~ 3 Unresolved ~ 1/);
	const legend = html.match(/<div class="legend">([\s\S]*?)<\/div>/)[1];
	assert.deepEqual([...legend.matchAll(/class="o-([a-z-]+)"/g)].map(m => m[1]), ['fixed-in-pr', 'fixed-later', 'pending']);
});

test('with nothing resolved the RESOLVED bracket is left out and Issues fixed is 0', () => {
	const html = render([row('pending'), row('unclear')]);
	assert.doesNotMatch(html, /class="bracket resolved"/);
	assert.match(text(html), /Unresolved ~ 2/);
	assert.match(text(html), /Issues fixed 0 /);
});

test('each bar segment has a detail to show in place of the legend: a large share, its count, and what it means', () => {
	const html = render([row('pending'), row('fixed-in-pr'), row('fixed-in-pr'), row('fixed-in-pr')]);
	const detail = html.match(/<div class="seg-detail" data-for="fixed-in-pr" hidden>[\s\S]*?<\/div><\/div>/)[0];
	assert.match(detail, /<span class="hero" style="color:#3B7D4F">75%<\/span>/);
	assert.match(text(detail), /Fixed in the PR ~ 3 of 4 findings A commit pushed to the PR after the run fixed it\./);
	assert.match(html, /<div class="seg-detail" data-for="pending" hidden><span class="hero" style="color:#2B2A27">/);
	assert.match(render([row('not-acted-on')]), /<span class="hero" style="color:#7D7568">100%/);
});

test('the palette is the warm one from the handoff', () => {
	const html = render([row('not-acted-on')]);
	assert.match(html, /\.o-not-acted-on\{background:#7D7568;color:#FFF\}/);
	assert.match(html, /\.o-fixed-in-pr\{background:#3B7D4F;color:#FFF\}/);
	assert.match(html, /body\{[^}]*background:#F5F4F0/);
	assert.match(html, /a:not\(\.seg\):hover\{color:#1F4D3D\}/);
	assert.match(html, /family=Source\+Serif\+4/);
});

test('severity rows always show Major, Moderate and Minor, as fixed of tracked', () => {
	const html = render(today);
	const t = text(section(html, 'sev-h'));
	assert.match(t, /% fixed = fixed \/ findings we could track\. Too few so far to compare severities\./);
	assert.match(t, /Severity % fixed Outcomes Fixed of tracked/);
	assert.match(t, /Major - No Major findings in this period/);
	assert.match(t, /Moderate 100% 4 4 4 of 4 tracked 4 pending not yet tracked/);
	assert.match(t, /Minor 100% 4 1 3 5 of 5 tracked 3 pending not yet tracked/);
	assert.match(section(html, 'sev-h'), /aria-label="No data"/);
	assert.match(text(section(render([row('pending', { severity: 'major' })]), 'sev-h')), /Major - 1 None tracked yet 1 pending not yet tracked/);
});

test('enough tracked findings in every severity drops the too-few note', () => {
	const rows = ['major', 'moderate', 'minor'].flatMap(severity => [...Array(10)].map(() => row('fixed-in-pr', { severity })));
	assert.doesNotMatch(text(render(rows)), /Too few/);
});

test('By PR and Evidence start collapsed behind a heading button, PRs with the most findings first', () => {
	const html = render([row('fixed-in-pr', { pr: 5 }), row('pending', { pr: 7 }), row('not-acted-on', { pr: 7, finding: 2 })]);
	assert.match(html, /<h2 id="pr-h"><button type="button" class="acc" aria-expanded="false" aria-controls="pr-body">/);
	assert.match(html, /<div class="acc-body" id="pr-body" hidden>/);
	assert.match(html, /aria-controls="ev-body">/);
	assert.match(html, /id="ev-body" hidden>/);
	const by = section(html, 'pr-h');
	assert.ok(by.indexOf('>#7<') < by.indexOf('>#5<'));
	assert.match(text(by), /By PR 2 PRs/);
	assert.match(text(by), /#7 2 findings 1 1 1 not acted on ~ 1 open/);
	assert.match(text(by), /#5 1 finding 1 1 fixed/);
	assert.match(text(section(html, 'ev-h')), /> Evidence 3 findings All 3/);
});

test('the evidence filters leave out empty groups, and findings are grouped in palette order', () => {
	const html = render(today);
	const ev = text(section(html, 'ev-h'));
	assert.match(ev, /All 16 Fixed 9 Unresolved 7 Expand all/);
	assert.doesNotMatch(ev, /Not acted on 0/);
	assert.match(ev, /Fixed in the PR 8 A commit pushed.*Fixed later 1 Fixed on main.*Pending 7 PR still open/);
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
	assert.match(html, /<button type="button" class="row" aria-expanded="false" aria-controls="d1">/);
	assert.match(html, /<p class="ev">drops <code>&lt;b&gt;<\/code> now<\/p>/);
	assert.match(html, /<dt>Commits on the PR<\/dt><dd><a class="chip" href="https:\/\/github.com\/posit-dev\/positron\/commit\/abc1234">abc1234<\/a><\/dd>/);
	assert.match(html, /<dt>Files<\/dt><dd><code class="chip">src\/a.ts<\/code><\/dd>/);
	assert.match(text(html), /Decided by The diff, read by the model/);
	assert.match(text(html), /Run 37#2 ~ started by \/explore ~ skill 1\.9 ~ opus/);
	assert.match(html, /<a href="https:\/\/example.com\/r\/index.html">Open report<\/a>/);
	assert.match(html, /<a href="https:\/\/github.com\/posit-dev\/positron\/pull\/16556">Open PR<\/a>/);
	assert.match(text(render([row('pending', { decidedBy: 'window' })])), /Decided by Merged under 30 days ago, no fix found yet/);
});

test('a finding without paths or a source prefix has no Files or Commits line', () => {
	const html = render([row('no-paths', { decidedBy: 'none', evidence: 'the cause names no file' })]);
	assert.doesNotMatch(html, /<dt>Files<\/dt>/);
	assert.doesNotMatch(html, /<dt>Commits/);
	assert.match(text(html), /Decided by --/);
});

test('a possible duplicate is counted and tagged; a sure duplicate appears nowhere and is counted in the footer', () => {
	const html = render([row('fixed-in-pr', { dupMaybe: '9#1' }), row('fixed-in-pr', { title: 'Hidden twin', dupOf: '9#2' })]);
	assert.match(html, /<span class="maybe">Possible duplicate<\/span>/);
	assert.ok(!html.includes('Hidden twin'));
	assert.match(text(html), /All 1 /);
	assert.match(text(html), /Generated Oct 14, 2026 ~ 1 duplicate of earlier runs left out\./);
});

test('the footer says when the page was made and that duplicates are left out', () => {
	assert.match(text(render(today)), /Generated Oct 14, 2026 ~ Duplicates of earlier runs are left out\. $/);
});

test('titles are escaped and a report URL that is not http(s) is not linked', () => {
	const html = render([row('pending', { title: '<img src=x onerror=alert(1)>', reportUrl: 'javascript:alert(1)' })]);
	assert.ok(!html.includes('<img src=x'));
	assert.ok(!html.includes('javascript:'));
});

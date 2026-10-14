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
// Today's data from the handoff: 8 fixed in the PR, 1 fixed later, 3 not fixed, 4 on open PRs.
const today = [
	...[...Array(4)].map(() => row('fixed-in-pr', { severity: 'moderate' })),
	...[...Array(4)].map(() => row('fixed-in-pr')),
	row('fixed-later'),
	row('not-fixed', { severity: 'moderate', decidedBy: 'merged-no-fix' }),
	...[...Array(2)].map(() => row('not-fixed', { decidedBy: 'merged-no-fix' })),
	...[...Array(3)].map(() => row('pending', { severity: 'moderate', decidedBy: 'pr-open' })),
	row('pending', { decidedBy: 'pr-open' }),
];

test('summarize counts fixed, counted and not counted yet, after dropping duplicates', () => {
	const s = summarize([
		row('fixed-in-pr'), row('fixed-in-pr'), row('fixed-later'), row('not-fixed'),
		row('pending'), row('unclear'), row('no-paths'), row('fixed-in-pr', { dupOf: '9#1' }),
	]);
	assert.equal(s.total, 7);
	assert.equal(s.fixed, 3);
	assert.equal(s.counted, 4);
	assert.equal(s.notCounted, 3);
	assert.equal(s.dups, 1);
	assert.equal(s.counts['fixed-in-pr'], 2);
});

test('the headline counts findings fixed before merging out of those on merged or closed PRs', () => {
	const html = render(today);
	assert.match(text(html), /Does \/explore change what ships\? Developers fixed 8 of 12 findings before merging\./);
	assert.match(html, /<span class="green">8<\/span> of 12/);
	assert.doesNotMatch(text(html.match(/<p class="headline">[\s\S]*?<\/p>/)[0]), /%|resolved/);
	assert.match(render([row('fixed-in-pr'), row('fixed-in-pr'), row('pending')]), /Developers fixed <span class="green">all 2<\/span> findings before merging\./);
	assert.match(text(render([row('fixed-in-pr')])), /Developers fixed all 1 finding before merging\./);
	assert.match(text(render([row('fixed-later')])), /Developers fixed 0 of 1 finding before merging\./);
	assert.match(text(render([row('pending')])), /No PRs with findings have merged yet\./);
});

test('the eyebrow gives the date range, with the year once, and triggers only when mixed', () => {
	const one = render([row('fixed-in-pr', { postedAt: '2026-08-18T10:00:00Z' }), row('pending', { postedAt: '2026-10-13T08:00:00Z' })]);
	assert.match(text(one.match(/<div class="eyebrow">[\s\S]*?<\/div>/)[0]), /^ \/explore Aug 18 - Oct 13, 2026 $/);
	assert.match(one, /<time datetime="2026-08-18">Aug 18<\/time>/);
	const mixed = text(render([row('fixed-in-pr', { postedAt: '2025-12-20T10:00:00Z' }), row('pending', { trigger: 'auto', postedAt: '2026-01-05T08:00:00Z' })]));
	assert.match(mixed, /\/explore Dec 20, 2025 - Jan 5, 2026 ~ 1 started by \/explore ~ 1 started automatically/);
});

test('the cards give fixed with its split, PRs changed, and still open', () => {
	const t = text(render(today));
	assert.match(t, /Issues fixed 9 8 in the PR ~ 1 later Problems developers fixed after \/explore flagged them\./);
	assert.match(t, /PRs changed 1 of 1 PR PRs where at least one \/explore finding got fixed\./);
	assert.match(t, /Still open 4 findings Findings on PRs that haven't merged yet\. They count once the PR merges or closes\. Findings by outcome/);
	const two = text(render([row('fixed-in-pr'), row('pending', { pr: 2 }), row('unclear', { pr: 3 }), row('no-paths', { pr: 3 })]));
	assert.match(two, /PRs changed 1 of 3 PRs/);
	assert.match(two, /Still open 1 finding Findings on PRs/);
	assert.match(two, /merges or closes\. 2 more can't be checked \(unclear or no files named\)\./);
});

test('the header leaves out what the handoff removed', () => {
	const t = text(render(today));
	assert.doesNotMatch(t, /Outcome report|findings across|resolved|tracked|pending|acted on|known outcome|scored|can't check yet|30 days/i);
	assert.doesNotMatch(t.slice(0, t.indexOf('Findings by outcome')), /Generated|started by/);
});

test('the bar has one linked segment per outcome present, in palette order, and so does the legend', () => {
	const html = render([row('pending'), row('fixed-later'), row('fixed-in-pr'), row('fixed-in-pr')]);
	const bar = html.match(/<div class="bar big">([\s\S]*?)<\/div>/)[1];
	assert.deepEqual([...bar.matchAll(/class="seg o-([a-z-]+)"/g)].map(m => m[1]), ['fixed-in-pr', 'fixed-later', 'pending']);
	assert.match(bar, /href="#evidence" data-filter="fixed" data-key="fixed-in-pr"[^>]*style="width:50%">2<span>Fixed in the PR<\/span><\/a>/);
	assert.match(bar, /data-key="fixed-later"[^>]*>1<span>Fixed later<\/span>/);
	assert.doesNotMatch(bar, /title=/);
	assert.match(text(section(html, 'all-h')), /Findings by outcome Counted ~ 3 Not counted yet ~ 1/);
	const legend = html.match(/<div class="legend">([\s\S]*?)<\/div>/)[1];
	assert.deepEqual([...legend.matchAll(/class="o-([a-z-]+)"/g)].map(m => m[1]), ['fixed-in-pr', 'fixed-later', 'pending']);
});

test('with nothing counted the COUNTED bracket is left out and Issues fixed is 0', () => {
	const html = render([row('pending'), row('unclear')]);
	assert.doesNotMatch(html, /class="bracket counted"/);
	assert.match(text(html), /Not counted yet ~ 2/);
	assert.match(text(html), /Issues fixed 0 /);
});

test('each bar segment has a detail to show in place of the legend: share of counted, or a bare count when not counted', () => {
	const html = render([row('pending'), row('fixed-in-pr'), row('fixed-in-pr'), row('fixed-in-pr'), row('not-fixed')]);
	const detail = html.match(/<div class="seg-detail" data-for="fixed-in-pr" hidden>[\s\S]*?<\/div><\/div>/)[0];
	assert.match(detail, /<span class="hero" style="color:#3B7D4F">75%<\/span>/);
	assert.match(text(detail), /Fixed in the PR ~ 3 of 4 counted findings A commit pushed to the PR after the run fixed it\./);
	const open = html.match(/<div class="seg-detail" data-for="pending" hidden>[\s\S]*?<\/div><\/div>/)[0];
	assert.match(open, /<span class="hero" style="color:#2B2A27">1<\/span>/);
	assert.match(text(open), /PR still open ~ finding, not counted yet/);
	assert.match(text(render([row('pending'), row('pending')])), /PR still open ~ findings, not counted yet/);
	assert.match(render([row('not-fixed')]), /<span class="hero" style="color:#7D7568">100%/);
});

test('the palette is the warm one from the handoff', () => {
	const html = render([row('not-fixed')]);
	assert.match(html, /\.o-not-fixed\{background:#7D7568;color:#FFF\}/);
	assert.match(html, /\.o-fixed-in-pr\{background:#3B7D4F;color:#FFF\}/);
	assert.match(html, /body\{[^}]*background:#F5F4F0/);
	assert.match(html, /a:not\(\.seg\):hover\{color:#1F4D3D\}/);
	assert.match(html, /family=Source\+Serif\+4/);
});

test('severity rows always show Major, Moderate and Minor, as fixed of counted', () => {
	const html = render(today);
	const t = text(section(html, 'sev-h'));
	assert.match(t, /% fixed = findings fixed \(in the PR or later\) \/ findings on merged or closed PRs\. Too few so far to compare severities\./);
	assert.match(t, /Severity % fixed Outcomes Fixed of counted/);
	assert.match(t, /Major - No Major findings in this period/);
	assert.match(t, /Moderate 80% 4 1 3 4 of 5 counted 3 still open, not counted yet/);
	assert.match(t, /Minor 71% 4 1 2 1 5 of 7 counted 1 still open, not counted yet/);
	assert.match(section(html, 'sev-h'), /aria-label="No data"/);
	assert.match(text(section(render([row('pending', { severity: 'major' }), row('unclear', { severity: 'major' })]), 'sev-h')), /Major - 1 1 None counted yet 1 still open ~ 1 unclear, not counted yet/);
});

test('enough counted findings in every severity drops the too-few note', () => {
	const rows = ['major', 'moderate', 'minor'].flatMap(severity => [...Array(10)].map(() => row('fixed-in-pr', { severity })));
	assert.doesNotMatch(text(render(rows)), /Too few/);
});

test('By PR and Evidence start collapsed behind a heading button, PRs with the most findings first', () => {
	const html = render([row('fixed-in-pr', { pr: 5 }), row('pending', { pr: 7 }), row('not-fixed', { pr: 7, finding: 2 })]);
	assert.match(html, /<h2 id="pr-h"><button type="button" class="acc" aria-expanded="false" aria-controls="pr-body">/);
	assert.match(html, /<div class="acc-body" id="pr-body" hidden>/);
	assert.match(html, /aria-controls="ev-body">/);
	assert.match(html, /id="ev-body" hidden>/);
	const by = section(html, 'pr-h');
	assert.ok(by.indexOf('>#7<') < by.indexOf('>#5<'));
	assert.match(text(by), /By PR 2 PRs/);
	assert.match(text(by), /#7 2 findings 1 1 1 not fixed ~ 1 open/);
	assert.match(text(by), /#5 1 finding 1 1 fixed/);
	assert.match(text(section(html, 'ev-h')), /> Evidence 3 findings All 3/);
});

test('the evidence filters leave out empty groups, and findings are grouped in palette order', () => {
	const html = render(today);
	const ev = text(section(html, 'ev-h'));
	assert.match(ev, /All 16 Fixed 9 Not fixed 3 Not counted 4 Expand all/);
	assert.doesNotMatch(text(section(render([row('fixed-in-pr')]), 'ev-h')), /Not fixed 0|Not counted 0/);
	assert.match(ev, /Fixed in the PR 8 A commit pushed.*Fixed later 1 Fixed on main.*Not fixed 3 The PR merged or closed.*PR still open 4 The PR hasn't merged yet/);
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
	assert.match(text(render([row('not-fixed', { decidedBy: 'merged-no-fix' })])), /Decided by Merged with no fix found/);
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

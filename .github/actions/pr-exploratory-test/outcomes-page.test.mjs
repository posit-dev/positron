/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { renderOutcomesPage, renderView, resolveRange, splitEvidence, summarize, VIEW_SOURCE } from './outcomes-page.mjs';

const row = (outcome, extra = {}) => ({
	pr: 1, run: '10', finding: 1, title: 'A finding', severity: 'minor', trigger: 'explore', decidedBy: 'diff+model',
	reportUrl: 'https://example.com/r/index.html', skillVersion: '1.9', model: 'opus', outcome, evidence: '', paths: [], ...extra,
});
const NOW = new Date('2026-10-14T12:00:00Z');
const render = rows => renderOutcomesPage(rows, { now: NOW });
// Visible text only, with tags dropped and the entities used here undone.
const text = html => html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/g, '').replace(/<div class="range-menu"[\s\S]*?<\/div><\/div>/, '').replace(/<[^>]+>/g, ' ')
	.replace(/&middot;/g, '~').replace(/&ndash;/g, '-').replace(/&divide;/g, '/').replace(/&mdash;/g, '--').replace(/&#39;/g, '\'').replace(/\s+/g, ' ');
// The markup, without the embedded rows and the script's copy of the view.
const markup = html => html.replace(/<script[\s\S]*?<\/script>/g, '');
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
	const filed = summarize([row('fixed-in-pr'), row('filed-issue'), row('pending')]);
	assert.equal(filed.fixed, 1);
	assert.equal(filed.counted, 2);
	assert.equal(filed.notCounted, 1);
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
	assert.match(text(one.match(/<button type="button" class="range-btn"[\s\S]*?<\/button>/)[0]), /^ Aug 18 - Oct 13, 2026 $/);
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
	assert.match(bar, /href="#evidence" data-filter="fixed" data-key="fixed-in-pr"[^>]*>2<span>Fixed in the PR<\/span><\/a>/);
	assert.doesNotMatch(bar, /width:/);
	assert.match(bar, /data-key="fixed-later"[^>]*>1<span>Fixed later<\/span>/);
	assert.doesNotMatch(bar, /title=/);
	assert.match(text(section(html, 'all-h')), /Findings by outcome Counted ~ 3 Not counted yet ~ 1/);
	const legend = html.match(/<div class="legend">([\s\S]*?)<\/div>/)[1];
	assert.deepEqual([...legend.matchAll(/class="o-([a-z-]+)"/g)].map(m => m[1]), ['fixed-in-pr', 'fixed-later', 'pending']);	assert.equal(text(legend).trim(), 'Fixed in the PR Fixed later PR still open');
});

test('the brackets and the bar share one grid, a column per segment sized by its count', () => {
	const html = render([row('pending'), row('fixed-later'), row('fixed-in-pr'), row('fixed-in-pr')]);
	assert.match(html, /<div class="all" style="grid-template-columns:minmax\(0, 2fr\) minmax\(0, 1fr\) minmax\(0, 1fr\)">/);
	assert.match(html, /<div class="bracket counted" style="grid-column:1 \/ span 2">/);
	assert.match(html, /<div class="bracket not-counted" style="grid-column:3 \/ span 1">/);
	assert.match(markup(render([row('pending')])), /<div class="bracket not-counted" style="grid-column:1 \/ span 1">/);
	assert.match(html, /\.all\{display:grid;column-gap:3px;row-gap:8px\}/);
	assert.match(html, /\.brackets,\.bar\.big\{grid-column:1 \/ -1;display:grid;grid-template-columns:subgrid/);
});

test('with nothing counted the COUNTED bracket is left out and Issues fixed is 0', () => {
	const html = render([row('pending'), row('unclear')]);
	assert.doesNotMatch(markup(html), /class="bracket counted"/);
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
	assert.match(html, /\.o-filed-issue\{background:#B3A894;color:#2B2A27\}/);
	assert.match(html, /body\{[^}]*background:#F5F4F0/);
	assert.match(html, /main\{padding:56px 24px 96px\}/);
	assert.match(html, /\.page\{width:100%;max-width:1040px;margin:0 auto;/);
	assert.match(html, /<body><main><div class="page">[\s\S]*<footer>[\s\S]*<\/div><\/main>/);
	assert.match(html, /a:not\(\.seg\):hover\{color:#1F4D3D\}/);
	assert.match(html, /family=Source\+Serif\+4/);
});

test('severity rows always show Major, Moderate and Minor, with no fixed-of-counted column', () => {
	const html = render(today);
	const t = text(section(html, 'sev-h'));
	assert.match(t, /% fixed = findings fixed \(in the PR or later\) \/ findings on merged or closed PRs\. Too few so far to compare severities\./);
	assert.match(t, /Severity % fixed Outcomes Major/);
	assert.match(t, /Major - No Major findings in this period Moderate/);
	assert.match(t, /Moderate 80% 4 1 3 Minor 71% 4 1 2 1 $/);
	assert.doesNotMatch(t, /counted yet|of \d+ counted|Fixed of counted/);
	assert.doesNotMatch(section(html, 'sev-h'), /class="end"/);
	assert.match(section(html, 'sev-h'), /aria-label="No data"/);
	assert.match(text(section(render([row('pending', { severity: 'major' }), row('unclear', { severity: 'major' })]), 'sev-h')), /Major - 1 1 Moderate/);
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
	const filed = text(section(render([row('fixed-in-pr'), row('filed-issue'), row('filed-issue'), row('not-fixed'), row('pending')]), 'pr-h'));
	assert.match(filed, /#1 5 findings 1 2 1 1 1 fixed ~ 2 filed as issue ~ 1 not fixed ~ 1 open/);
	assert.match(text(section(html, 'ev-h')), /> Evidence 3 findings All 3/);
});

test('the evidence filters leave out empty groups, and findings are grouped in palette order', () => {
	const html = render(today);
	const ev = text(section(html, 'ev-h'));
	assert.match(ev, /All 16 Fixed 9 Not fixed 3 Not counted 4 Expand all/);
	assert.doesNotMatch(text(section(render([row('fixed-in-pr')]), 'ev-h')), /Not fixed 0|Not counted 0/);
	assert.match(ev, /Fixed in the PR 8 A commit pushed.*Fixed later 1 Fixed on main.*Not fixed 3 The PR merged or closed.*PR still open 4 The PR hasn't merged yet/);
	const filed = render([row('fixed-in-pr'), row('filed-issue'), row('not-fixed'), row('pending')]);
	assert.match(text(section(filed, 'ev-h')), /All 4 Fixed 1 Filed as issue 1 Not fixed 1 Not counted 1 Expand all/);
	assert.match(filed, /data-filter="filed" aria-pressed="false">Filed as issue 1</);
	assert.match(filed, /<div class="group" data-group="filed">/);
	assert.match(text(section(filed, 'ev-h')), /Fixed in the PR 1 .*Filed as issue 1 An issue matching the finding was opened after the run, and nothing has fixed it yet\. .*Not fixed 1 The PR merged or closed with no fix\. Moves to Filed as issue or Fixed later if that happens afterwards\./);
});

test('filed as issue sits between fixed later and not fixed, counted but not fixed, with an ink hero', () => {
	const html = render([row('not-fixed'), row('filed-issue'), row('fixed-later'), row('fixed-in-pr')]);
	const bar = html.match(/<div class="bar big">([\s\S]*?)<\/div>/)[1];
	assert.deepEqual([...bar.matchAll(/class="seg o-([a-z-]+)"/g)].map(m => m[1]), ['fixed-in-pr', 'fixed-later', 'filed-issue', 'not-fixed']);
	assert.match(bar, /data-filter="filed" data-key="filed-issue"/);
	const detail = html.match(/<div class="seg-detail" data-for="filed-issue" hidden>[\s\S]*?<\/div><\/div>/)[0];
	assert.match(detail, /<span class="hero" style="color:#2B2A27">25%<\/span>/);
	assert.match(text(detail), /Filed as issue ~ 1 of 4 counted findings/);
	assert.match(text(html), /Developers fixed 1 of 4 findings before merging\./);
	assert.match(text(html), /Fixed later 1 Fixed on main after the merge, or its issue was closed as completed\./);
});

test('a finding with an issue shows it as a linked chip with its state, else the issue from its evidence', () => {
	const html = render([row('filed-issue', { decidedBy: 'issue+model', evidence: 'issue #16290: same', issue: { number: 16290, url: 'https://github.com/posit-dev/positron/issues/16290', state: 'open' } })]);
	assert.match(html, /<dt>Issue<\/dt><dd><a class="chip" href="https:\/\/github.com\/posit-dev\/positron\/issues\/16290">#16290 &middot; open<\/a><\/dd>/);
	assert.match(text(html), /Decided by A matching issue, confirmed by the model/);
	assert.match(text(render([row('fixed-later', { decidedBy: 'issue-closed', issue: { number: 7, url: 'https://github.com/posit-dev/positron/issues/7', state: 'closed as completed' } })])), /Decided by Its issue was closed as completed .*Issue #7 ~ closed as completed/);
	assert.match(render([row('filed-issue', { evidence: 'issue #12: same' })]), /<dt>Issue<\/dt><dd><a class="chip" href="https:\/\/github.com\/posit-dev\/positron\/issues\/12">#12<\/a>/);
	assert.doesNotMatch(markup(render([row('filed-issue', { issue: { number: 3, url: 'javascript:alert(1)', state: 'open' } })])), /javascript:/);
	assert.doesNotMatch(render([row('fixed-in-pr')]), /<dt>Issue/);
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
	assert.ok(!markup(html).includes('Hidden twin'));
	assert.match(text(html), /All 1 /);
	assert.match(text(html), /Generated Oct 14, 2026 ~ 1 duplicate of earlier runs left out\./);
});

test('the footer says when the page was made and that duplicates are left out', () => {
	assert.match(text(render(today)), /Generated Oct 14, 2026 ~ Duplicates of earlier runs are left out\. $/);
});

test('titles are escaped and a report URL that is not http(s) is not linked', () => {
	const html = markup(render([row('pending', { title: '<img src=x onerror=alert(1)>', reportUrl: 'javascript:alert(1)' })]));
	assert.ok(!html.includes('<img src=x'));
	assert.ok(!html.includes('javascript:'));
});

const at = (outcome, postedAt, extra = {}) => row(outcome, { postedAt: `${postedAt}T10:00:00Z`, ...extra });
const spread = [at('fixed-in-pr', '2026-10-13'), at('not-fixed', '2026-10-01'), at('pending', '2026-08-20', { pr: 2 }), at('fixed-later', '2025-12-20', { pr: 3 })];

test('resolveRange: presets end on the generated date, all time spans the runs, custom is swapped, anything else is 30 days', () => {
	const dates = ['2025-12-20', '2026-08-20', '2026-10-13'];
	assert.deepEqual(resolveRange('7d', dates, '2026-10-14'), { key: '7d', from: '2026-10-08', to: '2026-10-14' });
	assert.deepEqual(resolveRange('30d', dates, '2026-10-14'), { key: '30d', from: '2026-09-15', to: '2026-10-14' });
	assert.deepEqual(resolveRange('90d', dates, '2026-10-14'), { key: '90d', from: '2026-07-17', to: '2026-10-14' });
	assert.deepEqual(resolveRange('all', dates, '2026-10-14'), { key: 'all', from: '2025-12-20', to: '2026-10-13' });
	assert.deepEqual(resolveRange('2026-09-30..2026-09-01', dates, '2026-10-14'), { key: 'custom', from: '2026-09-01', to: '2026-09-30' });
	for (const bad of [null, '', 'week', '2026-13-01..2026-09-01', '2026-09-01..', '2026-02-30..2026-03-01']) {
		assert.deepEqual(resolveRange(bad, dates, '2026-10-14'), { key: '30d', from: '2026-09-15', to: '2026-10-14' }, String(bad));
	}
});

test('the range filters findings by run date and everything recalculates', () => {
	const view = renderView(spread, { now: '2026-10-14', range: resolveRange('30d', [], '2026-10-14') });
	const t = text(view.head + view.body);
	assert.match(t, /Developers fixed 1 of 2 findings before merging\./);
	assert.match(t, /All 2 Fixed 1 Not fixed 1 Expand all/);
	assert.doesNotMatch(t, /PR still open \d|Fixed later \d/);
	assert.match(text(view.label), /^ ?Sep 15 - Oct 14, 2026 ?$/);
	const all = renderView(spread, { now: '2026-10-14', range: resolveRange('all', spread.map(r => r.postedAt.slice(0, 10)), '2026-10-14') });
	assert.match(text(all.body), /All 4 /);
	assert.match(text(all.label), /Dec 20, 2025 - Oct 13, 2026/);
});

test('an empty range says so and leaves out the sections', () => {
	const view = renderView(spread, { now: '2026-10-14', range: resolveRange('2026-09-02..2026-09-10', [], '2026-10-14') });
	assert.match(text(view.head), /Does \/explore change what ships\? No \/explore findings in this date range\./);
	assert.doesNotMatch(view.head, /class="cards"/);
	assert.doesNotMatch(view.body, /Findings by outcome|Fix rate|By PR|Evidence/);
	assert.match(text(view.body), /Generated Oct 14, 2026/);
});

test('the browser renders the same view as the server from the shipped source', () => {
	const ctx = vm.createContext({});
	vm.runInContext(`${VIEW_SOURCE}; globalThis.renderView = renderView; globalThis.resolveRange = resolveRange;`, ctx);
	const dates = spread.map(r => r.postedAt.slice(0, 10));
	const rows = [...spread, row('filed-issue', { postedAt: '2026-10-02T00:00:00Z', issue: { number: 4, url: 'https://github.com/posit-dev/positron/issues/4', state: 'open' } }), row('no-paths', { postedAt: '2026-10-03T00:00:00Z', severity: 'major', dupMaybe: '1#1' })];
	for (const key of ['7d', '30d', 'all', '2026-08-01..2026-10-02']) {
		const range = resolveRange(key, dates, '2026-10-14');
		assert.deepEqual(JSON.parse(JSON.stringify(ctx.resolveRange(key, dates, '2026-10-14'))), range);
		assert.deepEqual(JSON.parse(JSON.stringify(ctx.renderView(rows, { now: '2026-10-14', range }))), renderView(rows, { now: '2026-10-14', range }), key);
	}
});

test('the page renders all time with an inert picker, and embeds the rows where a title cannot close the script', () => {
	const html = render([...spread, at('pending', '2026-10-10', { title: '</script><img src=x>' })]);
	assert.match(html, /<button type="button" class="range-btn" aria-haspopup="menu" aria-expanded="false" aria-label="Date range: Dec 20, 2025 &ndash; Oct 13, 2026" disabled>/);
	assert.match(text(section(html, 'ev-h')), /All 5 /);
	const data = html.match(/<script id="rows" type="application\/json">([\s\S]*?)<\/script>/)[1];
	assert.ok(!data.includes('<'));
	assert.equal(JSON.parse(data).rows.length, 5);
	assert.equal(JSON.parse(data).now, '2026-10-14');
	assert.match(html, /<div class="range-menu" role="menu" aria-label="Date range" hidden>/);
	assert.deepEqual([...html.matchAll(/role="menuitemradio" data-range="([^"]+)"/g)].map(m => m[1]), ['7d', '30d', '90d', 'all', 'custom']);
	assert.match(html, /<input id="range-from" type="date" min="2025-12-20" max="2026-10-14">/);
});

test('the detail sits over the legend so nothing moves, and the row under the bar is only as tall as the legend', () => {
	const html = render(today);
	assert.match(html, /\.under\{position:relative;min-height:20px;margin-top:4px\}/);
	assert.match(html, /\.seg-detail\{position:absolute;top:0;left:0;right:0;/);
	assert.match(html, /\.hero\{[^}]*font-size:44px/);
});

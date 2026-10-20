/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { resolveRange } from './explore-pages.mjs';
import { renderTriagePage, renderView, VIEW_SOURCE } from './triage-page.mjs';

const TODAY = '2026-10-15';
const row = (num, out, extra = {}) => ({
	num, title: `Issue ${num}`, filed: '2026-10-01', closed: null, reportUrl: 'https://x/r/index.html', findingUrl: 'https://x/r/index.html#f1',
	sev: 'moderate', out, milestone: null, futureSince: null, type: 'Bug', areas: ['plots'], source: 'pr', skillVersion: '1.9', ...extra,
});
const rows = [
	row(1, 'completed', { sev: 'minor', closed: '2026-10-09' }),
	row(2, 'active', { milestone: '2027 Backlog', sev: 'minor' }),
	row(3, 'future', { futureSince: '2026-10-05', areas: ['plots', 'ui'] }),
	row(4, 'future', { futureSince: '2026-10-11' }),
	row(5, 'future', { futureSince: '2026-10-13', sev: null, skillVersion: null, type: null }),
	row(6, 'awaiting', { sev: 'major', areas: [], filed: '2026-10-12', skillVersion: '1.53' }),
	row(7, 'closed', { closed: '2026-10-10', filed: '2026-08-01', via: 'matched' }),
];
const ALL = resolveRange('all', rows.map(r => r.filed).sort(), TODAY);
const view = (filter, range = ALL) => renderView(rows, { now: TODAY, range, filter });
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/&middot;/g, '~').replace(/&#39;/g, '\'').replace(/\s+/g, ' ');
const section = (html, id) => html.slice(html.indexOf(`id="${id}-body"`)).split('</section>')[0];

test('the bar brackets triaged against awaiting and puts segments in outcome order', () => {
	const { bar } = view();
	assert.match(text(bar), /Triaged 6 Awaiting 1/);
	assert.deepEqual([...bar.matchAll(/class="seg o-(\w+)"/g)].map(m => m[1]), ['completed', 'active', 'future', 'closed', 'awaiting']);
	assert.match(bar, /style="grid-column:1 \/ span 4"/);
});

test('the bar detail adds the milestone for Release or backlog and the median days for Future', () => {
	const { bar } = view();
	assert.match(text(bar), /Now: 1 in 2027 Backlog\./);
	assert.match(text(bar), /Future Open in the Future milestone\. Median 4 days there\./);
	assert.doesNotMatch(text(bar), /of 6 triaged issues|of 7 findings/);
});

test('the headline counts fixed or planned issues out of the triaged ones', () => {
	assert.match(text(view().head), /Developers fixed or planned 2 of 6 triaged issues \(33%\) ?\./);
	assert.match(view().head, /Developers fixed or planned <span class="metric">2 of 6 triaged issues \(33%\)<\/span>\./);
	const only = (...outs) => renderView(rows.filter(r => outs.includes(r.out)), { now: TODAY, range: ALL }).head;
	assert.match(text(only('completed', 'awaiting')), /Developers fixed or planned all 1 triaged issue ?\./);
	assert.match(text(only('awaiting')), /None of these issues have been triaged yet\./);
});

test('an empty range keeps the sections but drops the bar', () => {
	const v = view({}, resolveRange('2026-01-01..2026-01-31', [], TODAY));
	assert.equal(v.bar, '');
	assert.match(text(v.head), /No \/explore issues were filed in this date range\./);
	assert.match(text(v.body), /All issues 0 issues/);
});

test('the range filters by the day an issue was filed', () => {
	const v = view({}, resolveRange('7d', rows.map(r => r.filed).sort(), TODAY));
	assert.match(text(v.body), /All issues 1 issue /);
	assert.match(v.body, /id="i6"/);
});

test('severity and feature rows share one scale, and an issue counts under each of its features', () => {
	const sev = section(view().body, 'sev');
	assert.match(sev, /data-sev="none"/);
	assert.match(sev, /style="width:100%"/);
	const feat = text(section(view().body, 'feat'));
	assert.match(feat, /plots 6 .* ui 1 .* \(no feature label\) 1/);
});

test('skill versions sort newest first by number, with unrecorded last', () => {
	const kind = text(section(view().body, 'kind'));
	assert.match(kind, /Skill version 1\.53 1 1\.9 5 Not recorded 1/);
});

test('the issue list follows the filter and says so in a clearable chip', () => {
	const all = section(view().body, 'issues');
	assert.deepEqual([...all.matchAll(/id="i(\d+)"/g)].map(m => Number(m[1])), [1, 2, 5, 4, 3, 7, 6]);
	const futureModerate = section(view({ out: 'future', sev: 'moderate' }).body, 'issues');
	assert.match(text(futureModerate), /Showing Moderate ~ Future ~ 2/);
	assert.match(futureModerate, /aria-label="Clear filter, show all issues"/);
	assert.deepEqual([...futureModerate.matchAll(/id="i(\d+)"/g)].map(m => Number(m[1])), [4, 3]);
});

test('an issue number from the other page lists just that issue, or none when it is not here', () => {
	assert.deepEqual([...section(view({ issue: 3 }).body, 'issues').matchAll(/id="i(\d+)"/g)].map(m => m[1]), ['3']);
	assert.match(text(section(view({ issue: 99 }).body, 'issues')), /Showing #99 ~ 0 .*No issues match this filter/);
});

test('each issue row shows where it stands and for how long', () => {
	const t = text(section(view().body, 'issues'));
	assert.match(t, /completed Oct 9/);
	assert.match(t, /2027 Backlog/);
	assert.match(t, /10 days in Future/);
	assert.match(t, /filed 3 days ago/);
	assert.match(t, /closed Oct 10/);
	assert.match(t, /#7 ~ plots ~ filed Aug 1 ~ matched ~ report/);
	assert.doesNotMatch(t, /#1 ~ plots ~ filed Oct 1 ~ matched/);
});

test('the breakdown counts issues filed from the report apart from matched ones', () => {
	assert.match(text(section(view().body, 'kind')), /Linked by Filed from the report 6 Matched to its finding 1/);
});

test('the page has the shared top row and footer, and the counting panel says which issues count', () => {
	const html = renderTriagePage({ rows }, { now: new Date(`${TODAY}T12:00:00Z`) });
	assert.match(html, /<nav[^>]*class="switch"[\s\S]*aria-current="page"[^>]*>Triage outcomes/);
	assert.match(html, /<footer>Updated /);
	assert.match(text(html), /issues filed by hand that the Shipping impact page matched to a finding and that mention its PR/);
	assert.doesNotMatch(text(html), /left out/);
});

test('the browser renders the same view as the server', () => {
	const ctx = vm.createContext({});
	vm.runInContext(`${VIEW_SOURCE}; globalThis.renderView = renderView;`, ctx);
	for (const [range, filter] of [[ALL, {}], [ALL, { area: 'ui' }], [resolveRange('7d', [], TODAY), { issue: 6 }]]) {
		assert.deepEqual(JSON.parse(JSON.stringify(ctx.renderView(rows, { now: TODAY, range, filter }))), view(filter, range));
	}
});

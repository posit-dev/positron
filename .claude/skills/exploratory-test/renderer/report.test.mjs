/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { modelDisplayName, parseLedger, parseReport, parseSystemLine, safeUrl } from './report-parse.mjs';
import { renderReportHtml, skillVersion } from './html.mjs';

/** A minimal report with one of everything the template lays out. */
function md(...body) {
	return [
		'# Exploratory test: something',
		'',
		'`branch/name` | `abc1234`',
		'',
		'**Result:** It works. **But not on slow sources.**',
		'**Tested:** the summary panel on two backends, 3 scenarios',
		'**Not exercised:** the web build',
		'',
		...body,
	].join('\n');
}

const FINDINGS = [
	'## Findings',
	'',
	'| # | Finding | Severity | Impact | Introduced? | Reproduction | Verified |',
	'|---|---------|----------|--------|-------------|--------------|----------|',
	'| 1 | a claim | major | blocks completion | yes | 3/3 | confirmed |',
	'| 2 | b claim | minor | icon touches text | no | 1/1 | confirmed |',
	'',
	'### Finding 1: a longer claim',
	'',
	'> **Confirmed** | Reproduced **3/3** | **Introduced by this change**',
	'',
	'Two sentences a reader can follow.',
	'',
	'![](https://cdn.example/shots/01-stuck.png)',
	'',
	'**Repro** -- starting state: a console with pandas',
	'',
	'1. Run the thing.',
	'2. Wait 15 s.',
	'',
	'**Observed:** it spun forever.',
	'',
	'**Expected:** it should have stopped.',
	'',
	'**Preconditions:** default settings.',
	'',
	'**Evidence**',
	'',
	'- [shots/01-stuck.png](https://cdn.example/shots/01-stuck.png) -- the spinner, 60 s later',
	'- `logs/app.log` -- `[123:INFO:CONSOLE] "RPC timed out after 5 seconds"`, repeated twice',
	'',
	'**Cause (hypothesis):** the timeout was cut to 10 s.',
	'',
	'### 2. a second claim',
	'',
	'> **Confirmed** | Reproduced **1/1** | **Pre-existing**',
	'',
	'A second finding.',
	'',
	'**Observed:** the icon touches the text.',
	'',
	'**Expected:** a 6 px gap.',
	'',
].join('\n');

const COVERAGE = [
	'## Coverage',
	'',
	'### Verified',
	'',
	'| Scenario | Result | Screenshot |',
	'|---|---|---|',
	'| pandas frame | everything loads | [shots/01.png](https://cdn.example/shots/01.png) |',
	'| polars frame | same as pandas | |',
	'| expand while paused | dots never resolve (finding 1) | [shots/02.png](https://cdn.example/shots/02.png) |',
	'',
	'### Not exercised',
	'',
	'| Scenario | Reason |',
	'|---|---|',
	'| the web build | desktop only |',
	'',
].join('\n');

const FOLDS = [
	'<details>',
	'<summary>Run details</summary>',
	'',
	'### Change under test',
	'',
	'`git diff a...b`.',
	'',
	'### Environment',
	'',
	'A pre-launched instance.',
	'',
	'</details>',
	'',
	'<details>',
	'<summary>Verification details</summary>',
	'',
	'A second agent re-read this report.',
	'',
	'VERDICTS: 1=CONFIRMED; 2=FALSE POSITIVE',
	'',
	'**1.** Checks out.',
	'',
	'</details>',
	'',
	'_explore: Opus 5.5 | $3.12 | 77/200 turns | 26m_',
	'_verify: $0.63 | 31 turns | 5m_',
	'_total: $3.75 | 31m_',
].join('\n');

const FULL = md(FINDINGS, COVERAGE, FOLDS);

test('parseReport lifts the title, the chips and the lead out of the header', () => {
	const r = parseReport(FULL);
	assert.equal(r.title, 'something');
	assert.deepEqual(r.chips, ['branch/name', 'abc1234']);
	// The agent's own emphasis survives: it is the only thing that watched the
	// run, so it is the only thing that knows which clause is the point.
	assert.match(r.leadHtml, /<strong>But not on slow sources\.<\/strong>/);
});

test('parseReport drops emphasis that covers the whole Result', () => {
	const r = parseReport(md('**Result:** **Everything is broken everywhere.**'));
	// Emphasis on everything emphasises nothing, so it is not rendered as such.
	assert.doesNotMatch(r.leadHtml, /<strong>/);
	assert.match(r.leadHtml, /Everything is broken everywhere\./);
});

test('parseReport reads the scope as a sentence, without the scenario count', () => {
	const r = parseReport(FULL);
	// Coverage's own table is the count; repeating it made the reader check one
	// against the other for nothing.
	assert.equal(r.scopeHtml, 'The summary panel on two backends.');
});

test('parseReport tallies severities and scenarios for the tiles', () => {
	const r = parseReport(FULL);
	assert.equal(r.findingCount, 2);
	assert.deepEqual(r.severityCounts, { major: 1, moderate: 0, minor: 1 });
	assert.deepEqual(r.scenarios, { exercised: 3, pass: 2, issues: 1, notRun: 1 });
});

test('parseReport accepts both finding heading shapes', () => {
	const r = parseReport(FULL);
	assert.deepEqual(r.findings.map(f => f.n), [1, 2]);
	assert.equal(r.findings[0].title, 'a longer claim');
	assert.equal(r.findings[1].title, 'a second claim');
});

test('the Findings table has no Origin, and an old Introduced? column or origin strip renders nothing', () => {
	// FULL still carries both, as reports written before Origin was dropped do.
	const html = renderReportHtml(FULL);
	const head = /<div class="row row-head findings-grid">(.*?)<\/div>/.exec(html)[1];
	assert.deepEqual([...head.matchAll(/<span[^>]*>([^<]*)<\/span>/g)].map(m => m[1]),
		['Severity', 'Finding and impact', 'Reproduced', 'Status']);
	assert.match(html, /\.findings-grid\{grid-template-columns:110px minmax\(0,1fr\) 90px 140px\}/);
	assert.doesNotMatch(html, /class="org|origin-cell|\.org\{|>Pre-existing<|>New</);
	assert.doesNotMatch(promptText(html, 1), /^(Origin|Introduced)/m);
});

test('parseReport breaks a finding into its labelled parts', () => {
	const f = parseReport(FULL).findings[0];
	assert.match(f.observedHtml, /it spun forever/);
	assert.match(f.expectedHtml, /it should have stopped/);
	assert.deepEqual(f.preconditions, ['A console with pandas']);
	assert.equal(f.steps.length, 2);
	assert.match(f.causeHtml, /timeout was cut to 10 s/);
	assert.equal(f.proseHtml, '');
});

test('parseReport folds the embedded shot into Evidence rather than repeating it', () => {
	const f = parseReport(FULL).findings[0];
	assert.equal(f.hero.src, 'https://cdn.example/shots/01-stuck.png');
	// Cited in both places, so it appears once, in the gallery.
	const shots = f.evidence.filter(e => e.kind === 'shot');
	assert.equal(shots.filter(e => e.file === '01-stuck.png').length, 1);
	assert.equal(shots[0].featured, true);
	assert.equal(shots[0].caption, 'The spinner, 60 s later');
});

test('parseReport keeps the fuller of the two captions for a shot cited twice', () => {
	const r = parseReport(md([
		'## Findings', '',
		'| # | Finding | Severity |', '|---|---|---|', '| 1 | a claim | minor |',
		'', '### Finding 1: a claim', '',
		'![The panel after the timeout, with no sparkline](https://cdn.example/shots/a.png)',
		'', '**Evidence**', '',
		'- [shots/a.png](https://cdn.example/shots/a.png) -- no sparkline',
	].join('\n')));
	// One is written to sit in a list, the other to stand alone; keep the one
	// that says more.
	assert.equal(r.findings[0].evidence[0].caption, 'The panel after the timeout, with no sparkline');
});

test('parseReport leads the gallery with an embedded shot Evidence never cites', () => {
	const r = parseReport(md([
		'## Findings', '',
		'| # | Finding | Severity |', '|---|---|---|', '| 1 | a claim | minor |',
		'', '### Finding 1: a claim', '',
		'![the failure](https://cdn.example/shots/hero.png)',
		'', '**Evidence**', '',
		'- [shots/other.png](https://cdn.example/shots/other.png) -- something else',
	].join('\n')));
	const shots = r.findings[0].evidence;
	// It is the shot chosen to show the failure best, so it goes first.
	assert.deepEqual(shots.map(e => e.file), ['hero.png', 'other.png']);
	assert.equal(shots[0].featured, true);
});

test('parseReport keeps a backtick-quoted log line whole past its inner quotes', () => {
	const log = parseReport(FULL).findings[0].evidence.find(e => e.kind === 'log');
	assert.equal(log.path, 'logs/app.log');
	// Closing on the first inner double quote used to cut the message in half.
	assert.equal(log.quote, '[123:INFO:CONSOLE] "RPC timed out after 5 seconds"');
	assert.equal(log.note, 'repeated twice');
});

test('parseReport keeps the prose of a finding whose body has no labels', () => {
	const r = parseReport(md([
		'## Findings', '',
		'| # | Finding | Severity |',
		'|---|---|---|',
		'| 1 | a claim | minor |',
		'', '### Finding 1: a claim', '',
		'Just some prose, in no particular shape.',
	].join('\n')));
	// A field that cannot be parsed is rendered as prose, never dropped.
	assert.match(r.findings[0].proseHtml, /Just some prose/);
	assert.match(renderReportHtml(md([
		'## Findings', '',
		'| # | Finding | Severity |', '|---|---|---|', '| 1 | a claim | minor |',
		'', '### Finding 1: a claim', '', 'Just some prose, in no particular shape.',
	].join('\n'))), /Just some prose/);
});

test('parseReport reads the Screenshot column and links a row to its finding', () => {
	const rows = parseReport(FULL).coverage.exercised;
	assert.equal(rows[0].shot.label, '01.png');
	assert.equal(rows[1].shot, null);
	assert.equal(rows[2].finding, 1);
	// The reference is lifted out of the sentence, which keeps Result to what
	// happened.
	assert.doesNotMatch(rows[2].resultHtml, /finding 1/i);
	assert.match(rows[2].resultHtml, /Dots never resolve/);
});

test('parseReport recovers a screenshot a report wrote inside the Result cell', () => {
	// The two-column shape predates the Screenshot column; older reports on the
	// CDN still have to render.
	const r = parseReport(md([
		'## Coverage', '', '### Verified', '',
		'| Scenario | Result |', '|---|---|',
		'| pandas frame | everything loads [shots/01.png](https://cdn.example/shots/01.png) |',
	].join('\n')));
	const row = r.coverage.exercised[0];
	assert.equal(row.shot.label, '01.png');
	assert.doesNotMatch(row.resultHtml, /shots\/01/);
});

test('parseReport splits Run details into its subsections and reads the verdicts', () => {
	const r = parseReport(FULL);
	assert.deepEqual(r.runDetails.map(s => s.title), ['Change under test', 'Environment']);
	assert.deepEqual(r.verification.verdicts, [
		{ n: 1, word: 'confirmed' },
		{ n: 2, word: 'disputed' },
	]);
});

test('parseReport reads each cost pass and the total', () => {
	const { cost } = parseReport(FULL);
	assert.equal(cost.total, '$3.75');
	// The run took 31 minutes; 26 of them were the explore pass.
	assert.equal(cost.duration, '31m');
	assert.deepEqual(cost.passes.map(p => p.label), ['explore', 'verify']);
	assert.equal(cost.passes[0].maxTurns, '200');
});

test('parseReport takes the one pass as the total when there was nothing to verify', () => {
	const { cost } = parseReport('# Exploratory test: x\n\n_explore: Opus 5.5 | $0.55 | 18/200 turns | 3m_\n');
	assert.equal(cost.total, '$0.55');
	assert.equal(cost.duration, '3m');
	assert.match(renderReportHtml('# Exploratory test: x\n\n_explore: Opus 5.5 | $0.55 | 18/200 turns | 3m_\n'), /<span class="tile-num">3m<\/span><span class="unit">\$0\.55<\/span>/);
});

test('renderReportHtml ships both themes, defaulting to Professional', () => {
	const html = renderReportHtml(FULL);
	assert.match(html, /<html lang="en" data-theme="professional">/);
	assert.match(html, /:root\[data-theme="professional"\]/);
	assert.match(html, /:root\[data-theme="party"\]/);
	// Applied before the first paint, so a saved choice does not flash.
	assert.ok(html.indexOf('localStorage.getItem') < html.indexOf('<body>'));
	assert.match(html, /aria-label="Switch to Party"/);
	assert.match(html, /aria-pressed="true"/);
});

test('renderReportHtml stays self-contained but for Google Fonts', () => {
	const html = renderReportHtml(FULL);
	assert.doesNotMatch(html, /<script[^>]+src=/);
	const sheets = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map(m => m[1]);
	assert.equal(sheets.length, 1);
	assert.match(sheets[0], /^https:\/\/fonts\.googleapis\.com\//);
	// Every family names a system fallback.
	assert.doesNotMatch(html, /--sans: '[^']+';/);
});

test('renderReportHtml links each summary tile to the section it counts', () => {
	const html = renderReportHtml(FULL);
	assert.match(html, /href="#findings" data-tip="Jump to Findings"/);
	// Deliberately Coverage, not Scenarios: it teaches where the numbers come from.
	assert.match(html, /href="#coverage" data-tip="Jump to Coverage"/);
	assert.match(html, /href="#run-details" data-tip="Jump to Run details"/);
});

test('renderReportHtml leaves a tile inert when its section does not exist', () => {
	// No Run details in this report, so the tile promises nothing it cannot do.
	const html = renderReportHtml(md(FINDINGS, COVERAGE));
	const tiles = html.slice(html.indexOf('<section class="tiles">'), html.indexOf('</section>'));
	assert.doesNotMatch(tiles, /href="#run-details"/);
	assert.doesNotMatch(tiles, /Jump to Run details/);
	// No pointer, no arrow and no tooltip either: it is not a link at all.
	assert.match(tiles, /<div class="tile">/);
	assert.equal((tiles.match(/tile-arrow/g) || []).length, 2);
});

test('renderReportHtml marks a major finding card only for the Party theme', () => {
	const html = renderReportHtml(FULL);
	assert.match(html, /<article id="f1" class="card major">/);
	assert.match(html, /<article id="f2" class="card">/);
	// Professional resolves the same class to no decoration at all.
	assert.match(html, /--major-card-shadow: none;/);
});

test('renderReportHtml renders thumbnails as lazy images that open the lightbox', () => {
	const html = renderReportHtml(FULL);
	const thumbs = [...html.matchAll(/<a class="shot" [^>]*>\s*<img [^>]*>/g)].map(m => m[0]);
	assert.ok(thumbs.length >= 1);
	for (const thumb of thumbs) {
		assert.match(thumb, /loading="lazy"/);
		assert.match(thumb, /alt="[^"]+"/);
		// A real link to the raw image, so it still works before the script runs.
		assert.match(thumb, /href="https:\/\/cdn\.example\/shots\//);
		assert.match(thumb, /aria-label="View full size: [^"]+"/);
	}
	assert.match(html, /<div class="lb" id="lightbox"[^>]*hidden>/);
});

test('renderReportHtml shows each screenshot once, under Evidence', () => {
	const html = renderReportHtml(FULL);
	const card = html.slice(html.indexOf('<article id="f1"'), html.indexOf('<article id="f2"'));
	// The embedded shot used to be rendered beside Reproduce as well.
	assert.equal((card.match(/<img src="[^"]*01-stuck\.png"/g) || []).length, 1);
	// The issue link carries the file name too, so look past the header.
	assert.ok(card.indexOf('01-stuck.png', card.indexOf('</header>')) > card.indexOf('>Evidence<'));
	assert.doesNotMatch(card.slice(card.indexOf('>Reproduce<'), card.indexOf('>Evidence<')), /<img /);
});

test('renderReportHtml lays every gallery out six across, whatever the count', () => {
	const gallery = body => {
		const html = renderReportHtml(md([
			'## Findings', '',
			'| # | Finding | Severity |', '|---|---|---|', '| 1 | a claim | minor |',
			'', '### Finding 1: a claim', '', '**Evidence**', '', ...body,
		].join('\n')));
		return (/<div class="shots[^"]*"/.exec(html) || [])[0];
	};
	const shot = n => `- [shots/${n}.png](https://cdn.example/shots/${n}.png) -- shot ${n}`;
	assert.equal(gallery([shot(1)]), '<div class="shots"');
	assert.equal(gallery([shot(1), shot(2), shot(3), shot(4), shot(5)]), '<div class="shots"');
	const css = renderReportHtml(md(['## Findings'].join('\n')));
	assert.match(css, /\.shots\{display:grid;grid-template-columns:repeat\(6,minmax\(0,1fr\)\);gap:12px\}/);
});

test('renderReportHtml renders a run with no findings and no issues', () => {
	const html = renderReportHtml(md([
		'## Coverage', '', '### Verified', '',
		'| Scenario | Result | Screenshot |', '|---|---|---|',
		'| pandas frame | everything loads | |',
	].join('\n')));
	// No rows to label, so no column header: just the empty state.
	assert.match(html, /id="findings"/);
	assert.doesNotMatch(html, /row-head findings-grid/);
	assert.match(html, /<b>No new findings<\/b><span class="ki-empty-sum"><b>1<\/b> passed<\/span><\/span><a class="ki-ev ki-empty-go" href="#coverage">See Coverage<\/a><\/div>/);
	assert.match(html, /<div class="tile-num">0<\/div>/);
	// One scenario, all passing: no issue segment and no not-run segment.
	assert.match(html, /<b>1<\/b> pass/);
	assert.doesNotMatch(html, /<b>\d+<\/b> issues/);
	assert.doesNotMatch(html, /<b>\d+<\/b> not run/);
});

test('renderReportHtml escapes a title that contains markup', () => {
	const html = renderReportHtml('# A <script>alert(1)</script> title\n\nbody');
	assert.doesNotMatch(html, /<title>[^<]*<script>/);
	assert.match(html, /&lt;script&gt;/);
});

test('renderReportHtml survives a report with no title', () => {
	const html = renderReportHtml('just prose, no heading');
	assert.match(html, /<h1 class="title">Exploratory test<\/h1>/);
});

// A report is written by an agent reading a branch's diff, its logs and its UI,
// and the page is published on a domain shared with every other run. Anything a
// hostile branch can get quoted into a report must come out as text.

test('safeUrl keeps http, https, mailto and relative paths', () => {
	assert.equal(safeUrl('https://cdn.example/shots/a.png'), 'https://cdn.example/shots/a.png');
	assert.equal(safeUrl('http://x/a.png'), 'http://x/a.png');
	assert.equal(safeUrl('mailto:a@b.c'), 'mailto:a@b.c');
	assert.equal(safeUrl('shots/a.png'), 'shots/a.png');
	assert.equal(safeUrl('/shots/a.png'), '/shots/a.png');
});

test('safeUrl rejects a scheme that can execute, however it is spelled', () => {
	assert.equal(safeUrl('javascript:alert(1)'), null);
	assert.equal(safeUrl('JaVaScRiPt:alert(1)'), null);
	assert.equal(safeUrl('data:text/html,<script>alert(1)</script>'), null);
	assert.equal(safeUrl('vbscript:msgbox'), null);
	// Browsers ignore control characters inside a scheme; the guard must too.
	assert.equal(safeUrl('java\nscript:alert(1)'), null);
	assert.equal(safeUrl('  javascript:alert(1)'), null);
	assert.equal(safeUrl(''), null);
});

test('parseReport renders raw HTML in a report as text, not markup', () => {
	const r = parseReport(md([
		'## Findings', '',
		'| # | Finding | Severity |', '|---|---|---|', '| 1 | a claim | minor |',
		'', '### Finding 1: a claim', '',
		'**Observed:** it broke <img src=x onerror=alert(1)> and <script>alert(2)</script>.',
		'', '**Expected:** a `<div>` element, shown as code.',
	].join('\n')));
	const f = r.findings[0];
	// The words survive as text -- "onerror" is still readable -- but no tag does.
	assert.doesNotMatch(f.observedHtml, /<img|<script/);
	assert.match(f.observedHtml, /&lt;img src=x onerror=alert\(1\)&gt;/);
	assert.match(f.observedHtml, /&lt;script&gt;alert\(2\)&lt;\/script&gt;/);
	// A code span still shows its angle brackets, which is why this is escaped
	// at the renderer rather than by mangling the input.
	assert.match(f.expectedHtml, /<code>&lt;div&gt;<\/code>/);
});

test('parseReport strips a link a reader could be made to execute', () => {
	const r = parseReport(md([
		'## Findings', '',
		'| # | Finding | Severity |', '|---|---|---|', '| 1 | a claim | minor |',
		'', '### Finding 1: a claim', '',
		'**Observed:** see [the log](javascript:alert(1)) and [the shot](https://cdn.example/a.png).',
	].join('\n')));
	const observed = r.findings[0].observedHtml;
	assert.doesNotMatch(observed, /javascript:/);
	// The words survive; only the link does not.
	assert.match(observed, /the log/);
	assert.match(observed, /<a href="https:\/\/cdn\.example\/a\.png">the shot<\/a>/);
});

test('parseReport refuses an evidence shot whose extension hides its scheme', () => {
	const r = parseReport(md([
		'## Findings', '',
		'| # | Finding | Severity |', '|---|---|---|', '| 1 | a claim | minor |',
		'', '### Finding 1: a claim', '', '**Evidence**', '',
		'- [shots/01.png](javascript:alert(1)//shots/01.png) -- looks like a screenshot',
		'- [shots/02.png](https://cdn.example/shots/02.png) -- a real one',
	].join('\n')));
	const evidence = r.findings[0].evidence;
	// basename() ends in .png either way, so the extension test alone let it past.
	assert.deepEqual(evidence.filter(e => e.kind === 'shot').map(e => e.src),
		['https://cdn.example/shots/02.png']);
	assert.doesNotMatch(renderReportHtml(md([
		'## Findings', '',
		'| # | Finding | Severity |', '|---|---|---|', '| 1 | a claim | minor |',
		'', '### Finding 1: a claim', '', '**Evidence**', '',
		'- [shots/01.png](javascript:alert(1)//shots/01.png) -- looks like a screenshot',
	].join('\n'))), /javascript:/);
});

test('parseReport refuses a coverage screenshot with an executable scheme', () => {
	const r = parseReport(md([
		'## Coverage', '', '### Verified', '',
		'| Scenario | Result | Screenshot |', '|---|---|---|',
		'| a scenario | it worked | [shots/01.png](javascript:alert(1)//shots/01.png) |',
		'| another | it worked | [shots/02.png](https://cdn.example/shots/02.png) |',
	].join('\n')));
	assert.equal(r.coverage.exercised[0].shot, null);
	assert.equal(r.coverage.exercised[1].shot.href, 'https://cdn.example/shots/02.png');
});

test('renderReportHtml emits no executable scheme anywhere on the page', () => {
	const html = renderReportHtml(FULL);
	assert.doesNotMatch(html, /href="\s*javascript:/i);
	assert.doesNotMatch(html, /src="\s*(?:javascript|data):/i);
});

test('parseReport takes the chips from the header, not from anywhere backticked', () => {
	const r = parseReport([
		'# Exploratory test: something',
		'',
		'**Result:** It works.',
		'',
		'## Findings',
		'',
		'| # | Finding | Severity |',
		'|---|---|---|',
		'| 1 | a claim | minor |',
		'',
		'### Finding 1: a claim',
		'',
		'**Observed:** `some/path.ts` misbehaves.',
	].join('\n'));
	// No branch line in this report, so there are no chips to show. Reaching
	// into a finding's body for the first backticks put `some/path.ts` in the
	// header as if it were the commit.
	assert.deepEqual(r.chips, []);
});

test('renderReportHtml counts each coverage kind on its filter tab', () => {
	const html = renderReportHtml(FULL);
	const tabs = html.slice(html.indexOf('<div class="cf-tabs">'), html.indexOf('<div class="panel cf-card">'));
	const counts = [...tabs.matchAll(/<span class="cf-l">([^<]+) <span class="cf-cnt">(\d+)<\/span><\/span>/g)].map(m => `${m[1]} ${m[2]}`);
	assert.deepEqual(counts, ['All 4', 'Failed 1', 'Passed 2', 'Not run 1']);
	// A hidden semibold copy holds each tab's selected width.
	assert.match(tabs, /<span class="cf-g" aria-hidden="true">Passed 2<\/span><\/label>/);
	// One radio per tab, All checked, all ahead of the tabs and the card.
	assert.match(html, /<input type="radio" name="cf" id="cf-all" class="cf-radio" checked><input type="radio" name="cf" id="cf-i" class="cf-radio"><input type="radio" name="cf" id="cf-p" class="cf-radio"><input type="radio" name="cf" id="cf-n" class="cf-radio">\n<div class="cf-tabs">/);
	// One table: no subheadings, no dashed second table.
	assert.doesNotMatch(html, /cov-title|panel dashed|cov-group/);
	assert.match(html, /<div class="section-head"><h2 class="section-label">Exploratory Coverage<\/h2><\/div>/);
});

test('renderReportHtml omits a filter tab with no rows, but never All', () => {
	const html = renderReportHtml(md([
		'## Coverage', '', '### Exercised', '',
		'| Scenario | Result | Screenshot |', '|---|---|---|',
		'| pandas frame | fine | |',
	].join('\n')));
	assert.match(html, /<label for="cf-all"/);
	assert.match(html, /<label for="cf-p"/);
	assert.doesNotMatch(html, /id="cf-i"|id="cf-n"|for="cf-i"|for="cf-n"/);
	// The line only follows a Not exercised section the report actually wrote.
	assert.doesNotMatch(html, /cov-empty">/);
});

test('renderReportHtml puts the status dot inside the scenario cell', () => {
	const html = renderReportHtml(FULL);
	// The dot belongs to the scenario, so it is not a grid column of its own and
	// the header indents its label to where the text starts instead.
	assert.match(html, /<span class="cov-scenario"><span class="cov-dot pass" aria-hidden="true"><\/span><span>/);
	assert.match(html, /<span class="cov-scenario"><span class="cov-dot issue" aria-hidden="true"><\/span><span>/);
	assert.match(html, /<span class="cov-scenario"><span class="cov-dot none" aria-hidden="true"><\/span><span>/);
	assert.match(html, /<div class="row row-head coverage-grid"><span class="cov-head-scenario">Scenario<\/span>/);
	assert.doesNotMatch(html, /coverage-grid"><span><\/span>/);
});

test('renderReportHtml signs off with a mark, not a cost line', () => {
	const html = renderReportHtml(FULL);
	assert.match(html, /<footer class="sig">/);
	assert.match(html, /<div class="sg" aria-hidden="true">/);
	assert.match(html, /Generated by <a class="sig-link"/);
	// The run's cost belongs on the Run tile. Nothing below the last section
	// shows cost, tokens or turns.
	const footer = html.slice(html.indexOf('<footer'));
	assert.doesNotMatch(footer, /\$\d|turns|tokens/);
	assert.doesNotMatch(html, /footer class="cost"/);
	// The tile still carries it.
	assert.match(html.slice(0, html.indexOf('<footer')), /\$3\.12/);
});

test('renderReportHtml links the signature to the skill that wrote the report', () => {
	const html = renderReportHtml(FULL);
	// The arrow says the link leaves the page, so it has to go somewhere.
	assert.match(html, /<a class="sig-link" href="https:\/\/github\.com\/posit-dev\/positron\/blob\/main\/\.claude\/skills\/exploratory-test\/SKILL\.md" target="_blank" rel="noreferrer">exploratory-test &#8599;<\/a>/);
	// The placeholder it replaced is gone.
	assert.doesNotMatch(html, /data-skill-url/);
});

test('renderReportHtml dates the copyright by the run, not the render', () => {
	const html = renderReportHtml(FULL, { startedAt: new Date(2031, 0, 5) });
	// Fine print directly under the credit, in the same footer.
	assert.match(html, /Generated by <a class="sig-link"[^\n]*<\/p>\n<p class="sig-legal">&copy; 2031 Posit Software, PBC<\/p>\n<\/footer>/);
	assert.match(renderReportHtml(FULL), new RegExp(`&copy; ${new Date().getFullYear()} Posit Software, PBC`));
});

test('renderReportHtml keeps the signature legible without animation', () => {
	const html = renderReportHtml(FULL);
	// Reduced motion keeps the line and the check and drops the performance.
	assert.match(html, /@media \(prefers-reduced-motion:reduce\)\{\s*\.sg \*\{animation:none !important\}/);
	assert.match(html, /\.sg-pop\{opacity:1\}/);
	assert.match(html, /\.sg-bug,\.sg-mag,\.sg-q,\.sg-bang\{opacity:0 !important\}/);
});

test('parseReport still reads the labels reports were published with', () => {
	// Renamed twice: "Only under" read backwards in the case that actually
	// occurs, and "Configuration" was less plain than "Preconditions". Reports
	// already on the CDN use the older names.
	for (const label of ['Only under', 'Configuration']) {
		const r = parseReport(md([
			'## Findings', '',
			'| # | Finding | Severity |', '|---|---|---|', '| 1 | a claim | minor |',
			'', '### Finding 1: a claim', '',
			`**${label}:** shipped defaults.`,
		].join('\n')));
		// "Shipped defaults" alone is the absence of a condition, so it is not
		// printed -- but it still parses, and a qualified one still shows.
		assert.deepEqual(r.findings[0].preconditions, [], label);
	}
});

test('renderReportHtml labels the setup and the actions separately', () => {
	const html = renderReportHtml(FULL);
	const repro = html.slice(html.indexOf('<div class="repro">'));
	assert.match(repro, /<div class="repro-label">Preconditions<\/div><ul class="preconditions">/);
	assert.match(repro, /<div class="repro-label">Steps<\/div>/);
	// Setup before actions, and neither of the phrasings this replaced.
	assert.ok(repro.indexOf('Preconditions') < repro.indexOf('>Steps<'));
	assert.doesNotMatch(html, /Only under|Start:/);
});

test('renderReportHtml drops a preconditions list that says only "defaults"', () => {
	const build = value => renderReportHtml(md([
		'## Findings', '',
		'| # | Finding | Severity |', '|---|---|---|', '| 1 | a claim | minor |',
		'', '### Finding 1: a claim', '',
		'**Repro** -- starting state: ', '',
		`**Preconditions:** ${value}`, '',
		'1. Do the thing.',
	].join('\n')));
	// Nothing to say, so no label and no empty list to read past.
	const bare = build('Shipped defaults.');
	assert.doesNotMatch(bare, /repro-label">Preconditions/);
	assert.match(bare, /<div class="repro-label">Steps<\/div>/);
	// Qualified, so it earns its line.
	const qualified = build('Shipped defaults. Slowness is manufactured with a slow hash.');
	assert.match(qualified, /<div class="repro-label">Preconditions<\/div>/);
	assert.match(qualified, /Slowness is manufactured/);
});

test('parseReport keeps a step that carries a code block, and the steps after it', () => {
	const r = parseReport(md([
		'## Findings', '',
		'| # | Finding | Severity |', '|---|---|---|', '| 1 | a claim | minor |',
		'', '### Finding 1: a claim', '',
		'One sentence of summary.',
		'',
		'**Repro** -- starting state: a notebook open',
		'',
		'1. Add a markdown cell with this source:',
		'   ```',
		'   <div class="alert">',
		'',
		'   **Tip:** text',
		'',
		'   </div>',
		'   ```',
		'2. Render the cell.',
		'3. Click **Show Details**.',
		'',
		'**Observed:** it broke.',
	].join('\n')));
	const f = r.findings[0];
	assert.equal(f.steps.length, 3);
	// The block belongs to step 1 rather than ending the list.
	assert.match(f.steps[0].blockHtml, /<pre><code>/);
	assert.match(f.steps[0].blockHtml, /&lt;div class=&quot;alert&quot;&gt;/);
	assert.match(f.steps[1].html, /Render the cell/);
	assert.match(f.steps[2].html, /Show Details/);
	// Everything after the fence used to fall through into the summary.
	assert.equal(f.summaryHtml, 'One sentence of summary.');
	assert.match(f.observedHtml, /it broke/);
});

test('parseReport reads a heading inside a step block as source, not a section', () => {
	const r = parseReport(md([
		'## Findings', '',
		'| # | Finding | Severity |', '|---|---|---|', '| 1 | a claim | minor |', '| 2 | another | minor |',
		'', '### Finding 1: a claim', '',
		'**Repro** -- starting state: a notebook open',
		'',
		'1. Add a markdown cell with this source:',
		'   ```',
		'   ## C13 styled div',
		'   ### 2. not a finding',
		'',
		'   <div style="color: red">',
		'   ```',
		'2. Render the cell.',
		'',
		'**Observed:** it broke.',
		'', '### Finding 2: another', '',
		'**Observed:** also broke.',
	].join('\n')));
	// The `## ` line used to end Findings, leaving step 1 an empty block.
	assert.equal(r.findings.length, 2);
	const [f] = r.findings;
	assert.equal(f.steps.length, 2);
	assert.match(f.steps[0].blockHtml, /## C13 styled div\n### 2\. not a finding\n\n&lt;div style=/);
	assert.match(f.observedHtml, /it broke/);
});

test('parseReport reads the preconditions line above or below the steps', () => {
	const build = order => md([
		'## Findings', '',
		'| # | Finding | Severity |', '|---|---|---|', '| 1 | a claim | minor |',
		'', '### Finding 1: a claim', '',
		'**Repro** -- starting state: a notebook open',
		'',
		...order,
		'',
		'**Observed:** it broke.',
	].join('\n'));
	const above = parseReport(build([
		'**Preconditions:** default settings.', '', '1. First.', '2. Second.',
	]));
	const below = parseReport(build([
		'1. First.', '2. Second.', '', '**Preconditions:** default settings.',
	]));
	for (const r of [above, below]) {
		// A label between Repro and the steps used to look like the end of the
		// list and take both steps with it.
		assert.equal(r.findings[0].steps.length, 2);
		assert.deepEqual(r.findings[0].preconditions, ['A notebook open']);
		assert.match(r.findings[0].observedHtml, /it broke/);
	}
});

test('parseReport widens a step fence past the source nested inside it', () => {
	const r = parseReport(md([
		'## Findings', '',
		'| # | Finding | Severity |', '|---|---|---|', '| 1 | a claim | minor |',
		'', '### Finding 1: a claim', '',
		'**Repro** -- starting state: a notebook open',
		'',
		'1. Add a cell:',
		'   ```',
		'   <details>',
		'',
		'   ```python',
		'   x = 1',
		'   ```',
		'   </details>',
		'   Text right after close.',
		'   ```',
		'2. Render it.',
	].join('\n')));
	const step = r.findings[0].steps[0].blockHtml;
	// Three backticks around three backticks closes early, spilling the rest of
	// the source onto the page as markup.
	assert.match(step, /Text right after close\.[\s\S]*<\/code><\/pre>/);
	assert.doesNotMatch(step, /<\/code><\/pre>[\s\S]*Text right after close/);
	assert.equal(r.findings[0].steps.length, 2);
});

test('renderReportHtml puts the whole run on the Run tile', () => {
	const html = renderReportHtml(FULL);
	const tile = html.slice(html.indexOf('<div class="tile-label">Run</div>'));
	// Both figures cover both passes; the duration used to be the explore
	// pass's while the cost beside it was the total.
	assert.match(tile, /<span class="tile-num">31m<\/span><span class="unit">\$3\.75<\/span>/);
});

test('parseReport reads the model off a footer line, and a line without one', () => {
	const { cost } = parseReport(FULL);
	assert.equal(cost.passes[0].model, 'Opus 5.5');
	assert.equal(cost.passes[0].cost, '$3.12');
	// Reports written before the model was recorded still parse.
	assert.equal(cost.passes[1].model, null);
	assert.equal(cost.passes[1].turns, '31');
});

test('parseReport reads a pass shorter than a minute', () => {
	const { cost } = parseReport('# t\n\n_verify: Sonnet 5 | $0.02 | 3 turns | <1m_');
	assert.equal(cost.passes[0].duration, '<1m');
	assert.equal(cost.passes[0].model, 'Sonnet 5');
});

test('renderReportHtml keys the Run tile by model and sizes stages by cost', () => {
	const html = renderReportHtml(FULL);
	const tiles = html.slice(html.indexOf('<section class="tiles">'), html.indexOf('</section>'));
	assert.match(tiles, /flex:312 1 0;background:var\(--stage-1\)/);
	assert.match(tiles, /flex:63 1 0;background:var\(--stage-2\)/);
	assert.match(tiles, /<b>Opus 5\.5<\/b> explore/);
	// No model on record: the role alone.
	assert.match(tiles, /<span class="legend-item">verify<\/span>/);
	// Turn counts live in the Agents table, not on the tile.
	assert.doesNotMatch(tiles, /turns|77/);
});

test('renderReportHtml opens Run details with the Agents table', () => {
	const html = renderReportHtml(FULL);
	assert.match(html, /<span class="hint">Agents, /);
	const agents = html.slice(html.indexOf('<div class="fold-part agents">'));
	assert.match(agents, /<span>Explore<\/span><span>Opus 5\.5<\/span><span class="num">\$3\.12<\/span><span class="num muted">77 of 200<\/span>/);
	assert.match(agents, /<span class="num muted">31<\/span>/);
	assert.match(agents, /<span>Total<\/span><span class="muted">31m elapsed<\/span><span class="num">\$3\.75<\/span><span class="num muted">108<\/span>/);
});

test('renderReportHtml gives a report with only cost lines a Run details fold', () => {
	const html = renderReportHtml('# t\n\n_explore: $1.00 | 5/200 turns | 2m_');
	assert.match(html, /<details id="run-details">/);
	assert.match(html, /<a class="tile tip" href="#run-details"/);
});

test('renderReportHtml orders issues, passes, then not run, and collapses the passes past the first 4', () => {
	const pass = n => `| pass ${n} | fine | |`;
	const html = renderReportHtml(md([
		'## Coverage', '', '### Exercised', '',
		'| Scenario | Result | Screenshot |', '|---|---|---|',
		...[1, 2, 3, 4, 5].map(pass),
		'| second hit | broke (Finding 2) | |',
		...[6, 7, 8].map(pass),
		'| first hit | broke (Finding 1) | |',
		...[9, 10].map(pass),
		'', '### Not exercised', '',
		'| Scenario | Reason |', '|---|---|',
		...Array.from({ length: 12 }, (_, i) => `| skip ${i} | later |`),
	].join('\n')));
	const body = html.slice(html.indexOf('<body'));
	const order = [...body.matchAll(/<span>((?:pass|first|second|skip) [^<]*)<\/span>/g)].map(m => m[1]);
	assert.deepEqual(order.slice(0, 7), ['first hit', 'second hit', 'pass 1', 'pass 2', 'pass 3', 'pass 4', 'pass 5']);
	assert.deepEqual(order.slice(12, 14), ['skip 0', 'skip 1']);
	assert.equal(order.length, 24);
	// Only passes collapse; every issue and not-run row shows under All.
	assert.equal((body.match(/cov-extra/g) || []).length, 6);
	assert.equal((body.match(/class="[^"]*cf-[in] cov-extra/g) || []).length, 0);
	// The footer counts the whole table.
	assert.match(html, /<input type="checkbox" id="cov-all" class="cov-toggle" aria-label="Show all 24 scenarios">/);
	assert.match(html, /<label for="cov-all" class="cov-more"><span class="cov-all">Show all 24 scenarios<\/span><span class="cov-less">Show fewer<\/span>/);
});

test('renderReportHtml shows a short Exercised table in full with no toggle', () => {
	const html = renderReportHtml(FULL);
	assert.doesNotMatch(html.slice(html.indexOf('<body')), /cov-toggle|cov-extra/);
});

test('renderReportHtml writes tile legends as plain text in bar order', () => {
	const html = renderReportHtml(FULL);
	const tiles = html.slice(html.indexOf('<section class="tiles">'), html.indexOf('</section>'));
	// No colour keys: each item names what it counts, split by a quiet middot.
	assert.doesNotMatch(tiles, /class="key"/);
	assert.match(tiles, /<span class="legend-item"><b>1<\/b> major<\/span><span class="legend-sep" aria-hidden="true">&middot;<\/span><span class="legend-item"><b>1<\/b> minor<\/span>/);
	assert.match(tiles, /<b>2<\/b> passed<\/span><span class="legend-sep" aria-hidden="true">&middot;<\/span><span class="legend-item"><b>1<\/b> failed<\/span><span class="legend-sep" aria-hidden="true">&middot;<\/span><span class="legend-item"><b>1<\/b> not run/);
});

test('renderReportHtml treats a placeholder Not exercised row as an empty list', () => {
	for (const cell of ['none', 'N/A', '-', '\u2014', '*None.*']) {
		const src = md([
			'## Coverage', '', '### Exercised', '',
			'| Scenario | Result | Screenshot |', '|---|---|---|',
			'| pandas frame | fine | |',
			'| polars frame | broke (Finding 1) | |',
			'', '### Not exercised', '',
			'| Scenario | Reason |', '|---|---|',
			`| ${cell} | |`,
		].join('\n'));
		const r = parseReport(src);
		assert.deepEqual(r.coverage.notExercised, [], cell);
		assert.equal(r.scenarios.notRun, 0, cell);
		const html = renderReportHtml(src);
		assert.match(html, /<\/div>\n<\/div>\n<p class="cov-empty">Everything in scope was exercised\.<\/p>\n<\/div>\n<\/section>/, cell);
		assert.doesNotMatch(html, /id="cf-n"/, cell);
		// A zero count gets no bar segment and no legend item.
		const tiles = html.slice(html.indexOf('<section class="tiles">'), html.indexOf('</section>'));
		assert.doesNotMatch(tiles, /not run|notrun-bar/, cell);
	}
});

test('renderReportHtml writes a not-run row as a Result spanning three columns', () => {
	const html = renderReportHtml(FULL);
	const row = html.match(/<div class="row coverage-grid cf-r cf-n" id="cv-row-\d+">[\s\S]*?<\/div>/)[0];
	assert.match(row, /<span class="cov-dot none" aria-hidden="true"><\/span>/);
	assert.match(row, /<span class="cov-notrun"><span class="cov-nr">Not run<\/span> &middot; /);
	// Nothing to open and no chevron cell.
	assert.doesNotMatch(row, /cv-chev|<details/);
	assert.doesNotMatch(html, /cov-head-reason|>Reason</);
});

/** The text of finding `n`'s copyable prompt block. */
function promptText(html, n) {
	const m = new RegExp(`<script type="text/plain" id="prompt-f${n}">([\\s\\S]*?)</script>`).exec(html);
	return m ? m[1] : null;
}

test('renderReportHtml writes each finding as an agent prompt, from the parsed fields', () => {
	const html = renderReportHtml(FULL, { base: '/runs/r1', diff: 'aaaa1111...bbbb2222' });
	assert.equal(promptText(html, 1), [
		'## Finding 1 — Major',
		'',
		'A longer claim.',
		'',
		'Status: Confirmed',
		'Reproduced: 3/3',
		'',
		'### Impact',
		'Blocks completion',
		'',
		'### Observed',
		'It spun forever.',
		'',
		'### Expected',
		'It should have stopped.',
		'',
		'### Preconditions',
		'A console with pandas',
		'',
		'### Reproduction',
		'1. Run the thing.',
		'2. Wait 15 s.',
		'',
		'### Evidence',
		'- https://cdn.example/shots/01-stuck.png — The spinner, 60 s later',
		'- /runs/r1/logs/app.log — [123:INFO:CONSOLE] "RPC timed out after 5 seconds" (Repeated twice)',
		'',
		'### Likely cause (hypothesis, not verified)',
		'The timeout was cut to 10 s.',
		'',
		'### Context',
		'Branch: branch/name',
		'Commit: abc1234',
		'Diff: aaaa1111...bbbb2222',
		'',
		'Please investigate this finding using the repository and the evidence above.',
	].join('\n'));
	// One button per card, last in the meta row, pointing at its own block.
	assert.match(html, /<span class="group context">[\s\S]*?<\/span><a class="gh-btn"[^>]*>[\s\S]*?<\/a><button type="button" class="cp-btn" data-tip="Copy prompt for agent" data-prompt="prompt-f1" aria-label="Copy prompt for an agent: finding 1"><svg class="cp-ico"[\s\S]*?<\/button><\/div>/);
	assert.match(html, /document\.querySelectorAll\('\.cp-btn,\.code-cp'\)/);
});

test('renderReportHtml leaves empty prompt sections out', () => {
	const html = renderReportHtml(md([
		'## Findings', '',
		'| # | Finding | Severity |', '|---|---|---|', '| 1 | a claim | minor |',
		'', '### Finding 1: a claim', '', '**Observed:** it broke.',
	].join('\n')));
	const text = promptText(html, 1);
	assert.match(text, /### Observed\nIt broke\./);
	assert.doesNotMatch(text, /### (Impact|Expected|Preconditions|Reproduction|Evidence|Likely cause)/);
	// No range was given, so Context names only what the header carries.
	assert.match(text, /### Context\nBranch: branch\/name\nCommit: abc1234\n\nPlease investigate/);
});

test('renderReportHtml copies a prompt mentioning </script> as written, not as escaped', () => {
	const html = renderReportHtml(md([
		'## Findings', '',
		'| # | Finding | Severity |', '|---|---|---|', '| 1 | a claim | minor |',
		'', '### Finding 1: a claim', '', '**Observed:** the tag `</script>` ended the block.',
	].join('\n')));
	const block = promptText(html, 1);
	assert.doesNotMatch(block, /<\/script/i);
	// Run the copy handler's own unescape over the block, as the page does.
	const [, pattern, flags, replacement] = /text=el\.textContent\.trim\(\)\.replace\(\/(.+?)\/([a-z]*),'([^']*)'\);/.exec(html);
	assert.match(block.replace(new RegExp(pattern, flags), replacement), /The tag `<\/script>` ended the block/);
});

test('renderReportHtml emits inline scripts that parse, cut where the HTML parser cuts them', () => {
	const html = renderReportHtml(FULL);
	const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script[\s/>]/gi)].map(m => m[1]);
	assert.ok(scripts.length >= 2);
	for (const src of scripts) {
		assert.doesNotThrow(() => new Function(src));
	}
});

test('renderReportHtml renders no prompt buttons, blocks or script when agent prompts are off', () => {
	const html = renderReportHtml(FULL, { agentPrompts: false });
	assert.doesNotMatch(html, /cp-btn"|id="prompt-f|querySelectorAll\('\.cp-btn,\.code-cp'\)/);
	// Filing an issue does not depend on the prompts.
	assert.match(html, /<a class="gh-btn"[^>]*>[\s\S]*?<\/a><\/div>/);
	assert.match(html, /<script type="text\/plain" id="issue-f1">/);
});

test('renderReportHtml greens only the check beside Confirmed in the findings table', () => {
	const html = renderReportHtml(FULL);
	assert.match(html, /<span class="status"><svg class="status-check" aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke-width="2"/);
	assert.doesNotMatch(html, /<span class="status"><svg[^>]*currentColor/);
	assert.match(html, /\.status\{[^}]*color:var\(--body\)/);
	assert.match(html, /\.status-check\{stroke:var\(--pass-fill\)\}/);
});

test('renderReportHtml points the tile arrow straight down', () => {
	const html = renderReportHtml(FULL);
	assert.match(html, /class="tile-arrow"[^>]*><path d="M8 3\.5v9"><\/path><path d="M4\.5 9l3\.5 3\.5L11\.5 9"><\/path><\/svg>/);
	assert.doesNotMatch(html, /M5 5l6 6/);
});

test('renderReportHtml mutes the Show all row and only recolours it on hover', () => {
	const html = renderReportHtml(FULL);
	assert.match(html, /\.cov-more\{[^}]*color:var\(--muted\);cursor:pointer;transition:color \.15s ease\}/);
	assert.match(html, /\.cov-more:hover\{color:var\(--link\)\}/);
});

/** A finding with every collapsed row, step-tagged shots, and a Steps column. */
const RICH = md([
	'## Findings', '',
	'| # | Finding | Severity | Reproduction |', '|---|---|---|---|',
	'| 1 | a claim | major | 3/3 |',
	'| 2 | b claim | minor | 1/1 |',
	'',
	'### 1. A column never loads, and Retry cannot help',
	'',
	'A summary that repeats Observed.',
	'',
	'**Repro**',
	'',
	'1. Open it.',
	'2. Wait.',
	'3. Click Retry.',
	'',
	'**Observed:** it never loads.',
	'',
	'**Evidence**',
	'',
	'- [shots/c.png](https://cdn.example/shots/c.png) -- Variant: five columns',
	'- [shots/b.png](https://cdn.example/shots/b.png) -- Step 3: after Retry',
	'- [shots/a.png](https://cdn.example/shots/a.png) -- Step 2: the notice',
	'- `logs/app.log` -- "timed out", twice',
	'',
	'**Error output** -- `logs/app.log` | Renderer | Logged 2x (after each Retry)',
	'',
	'```',
	'Error: get_column_profiles timed out after 10 seconds',
	'    at Client.getColumnProfiles (src/vs/client.ts:212:9)',
	'    at /abs/out/cache.js:538',
	'```',
	'',
	'**Error output** -- `logs/ext.log` | Extension host',
	'',
	'```',
	'Warning: no stack here',
	'```',
	'',
	'**Cause (hypothesis):** the timeout was cut.',
	'',
	'**Regression test**',
	'',
	'- Retry after a timeout loads the summary. -- Unit `src/vs/test/cache.test.ts` (exists, covers chunking only)',
	'- A slow source offers no Retry. -- E2E `test/e2e/tests/slow.test.ts` (new file)',
	'',
	'**Other tests that touch this code**',
	'',
	'- `src/vs/test/cache.test.ts` -- Unit, already named above',
	'- `src/vs/test/client.test.ts` -- Unit, checks request shape only',
	'',
	'### 2. b claim with nothing collapsed',
	'',
	'**Observed:** the icon touches the text.',
	'',
	'**Regression test**',
	'',
	'- One case only. -- Unit `src/vs/test/icon.test.ts` (exists)',
	'',
	'## Coverage',
	'',
	'### Verified',
	'',
	'| Scenario | Result | Screenshot | Steps |',
	'|---|---|---|---|',
	'| pandas frame | everything loads | | 1. Build `df`.<br>2. Run `%view df`. |',
	'| polars frame | same as pandas | | |',
	'| arrow frame | same as pandas | [shots/arrow.png](https://cdn.example/shots/arrow.png) | 1. Build `tbl`.<br>2. Verify it loads. |',
	'| duckdb frame | same as pandas | [shots/duck.png](https://cdn.example/shots/duck.png) | |',
	'| slow column | fails 3/3 (finding 1) | [shots/slow.png](https://cdn.example/shots/slow.png) | 1. Should not render. |',
	'',
	'### Not exercised',
	'',
	'| Scenario | Reason |',
	'|---|---|',
	'| the web build | desktop only |',
	'',
].join('\n'));

/** The card as rendered, without its prompt block. */
function card(html, n) {
	const start = html.indexOf(`<article id="f${n}"`);
	const end = html.indexOf('</article>', start);
	const prompt = html.indexOf('<script type="text/plain"', start);
	return html.slice(start, prompt !== -1 && prompt < end ? prompt : end);
}

test('renderReportHtml puts nothing between a finding title and Observed', () => {
	const c = card(renderReportHtml(RICH), 1);
	assert.doesNotMatch(c, /card-summary|repeats Observed/);
	assert.match(c, /<\/h2><\/header>\s*<div class="two">/);
});

test('renderReportHtml ends a card with closed rows: error, cause, regression test', () => {
	const c = card(renderReportHtml(RICH), 1);
	const rows = [...c.matchAll(/<details class="(lc[^"]*)">/g)].map(m => m[1]);
	assert.deepEqual(rows, ['lc', 'lc hyp', 'lc regtest']);
	assert.doesNotMatch(c, /<details class="lc[^"]*" open/);
	assert.match(c, /Error output<span class="lc-tail"> &middot; 1 error, 2×<\/span>/);
	assert.match(c, /Likely cause<span class="lc-tail"> &middot; Hypothesis<\/span>/);
	assert.match(c, /Regression test<span class="lc-tail"> &middot; 2 missing cases<\/span>/);
	assert.doesNotMatch(c, /class="cause"/);
});

test('the regression test follows the verdict: hidden when disputed, caveated when unresolved', () => {
	const verdict = word => RICH
		.replace('| # | Finding | Severity | Reproduction |', '| # | Finding | Severity | Reproduction | Verified |')
		.replace('|---|---|---|---|', '|---|---|---|---|---|')
		.replace('| 1 | a claim | major | 3/3 |', `| 1 | a claim | major | 3/3 | ${word} |`);
	const disputed = renderReportHtml(verdict('disputed'));
	assert.doesNotMatch(card(disputed, 1), /lc regtest/);
	assert.doesNotMatch(promptText(disputed, 1), /### Regression test/);
	const unresolved = renderReportHtml(verdict('unresolved'));
	assert.match(card(unresolved, 1), /Regression test<span class="lc-tail"> &middot; 2 missing cases \u00b7 finding unresolved<\/span>/);
	assert.match(promptText(unresolved, 1), /^### Regression test \(suggestion; the verifier left this finding unresolved\)$/m);
	assert.match(card(renderReportHtml(verdict('confirmed')), 1), /Regression test<span class="lc-tail"> &middot; 2 missing cases<\/span>/);
});

test('a finding the verifier matched to an issue says so on its card, and nowhere else', () => {
	const known = FULL
		.replace('| Reproduction | Verified |', '| Reproduction | Verified | Known |')
		.replace('|--------------|----------|', '|--------------|----------|---|')
		.replace('| 3/3 | confirmed |', '| 3/3 | confirmed | #15102, #14991 |')
		.replace('| 1/1 | confirmed |', '| 1/1 | confirmed | - |')
		.replace('VERDICTS: 1=CONFIRMED; 2=FALSE POSITIVE', 'VERDICTS: 1=CONFIRMED; 2=FALSE POSITIVE\nKNOWN: 1=#15102,#14991');
	assert.deepEqual(parseReport(known).findings.map(f => f.known), [[15102, 14991], []]);
	const html = renderReportHtml(known);
	assert.match(card(html, 1), /<\/h2><p class="ki-known"><span class="ki-i">[\s\S]*?<\/span><span>Possibly known: <a class="ki-num" href="https:\/\/github\.com\/posit-dev\/positron\/issues\/15102" target="_blank" rel="noopener">#15102<\/a>, <a class="ki-num" href="[^"]+\/issues\/14991"[^>]*>#14991<\/a><\/span><\/p>/);
	assert.doesNotMatch(card(html, 2), /Possibly known/);
	const row = /<a href="#f1" class="row findings-grid">.*?<\/a>\n/s.exec(html)[0];
	assert.doesNotMatch(row, /Possibly known|15102/, 'the row does not repeat it');
	// The cards carry it, so the verification fold does not repeat the raw line.
	assert.doesNotMatch(html, /KNOWN:/);
	assert.doesNotMatch(renderReportHtml(FULL), /class="ki-known"/);
});

test('renderReportHtml keeps the level of a missing case the agent could not place', () => {
	const html = renderReportHtml(md([
		'## Findings', '',
		'| # | Finding | Severity |', '|---|---|---|', '| 1 | a claim | minor |',
		'', '### Finding 1: a claim', '', '**Observed:** it broke.', '',
		'**Regression test**', '',
		'- A checked box reads as checked. -- Unit (new file)',
	].join('\n')));
	const c = card(html, 1);
	assert.match(c, /<li>A checked box reads as checked\.<div class="rt-meta rt-row"><span class="rt-t rt-t-tint">Unit<\/span><span>new file<\/span><\/div><\/li>/);
	assert.doesNotMatch(c, /rt-file|-- Unit/);
	assert.match(html, /- A checked box reads as checked\. \u2192 Unit test; place it per the repo's test guidance/);
});

test('renderReportHtml leaves out collapsed rows with nothing in them', () => {
	const html = renderReportHtml(md([
		'## Findings', '',
		'| # | Finding | Severity |', '|---|---|---|', '| 1 | a claim | minor |',
		'', '### Finding 1: a claim', '', '**Observed:** it broke.',
	].join('\n')));
	assert.doesNotMatch(card(html, 1), /card-details/);
	const second = card(renderReportHtml(RICH), 2);
	assert.deepEqual([...second.matchAll(/<details class="(lc[^"]*)">/g)].map(m => m[1]), ['lc regtest']);
});

test('renderReportHtml shows only errors with a stack, and links frames at the commit', () => {
	const c = card(renderReportHtml(RICH), 1);
	// A log beside the report opens from its path; the line stays in the text.
	assert.match(c, /<a href="logs\/app\.log" class="log-link err-src" title="Open the full log"[^>]*>logs\/app\.log<\/a><span>Renderer<\/span><span>Logged 2× \(after each Retry\)<\/span>/);
	assert.match(c, /<div class="err-msg">Error: get_column_profiles timed out after 10 seconds<\/div>/);
	assert.match(c, /at Client\.getColumnProfiles \(<a class="err-loc" href="https:\/\/github\.com\/posit-dev\/positron\/blob\/abc1234\/src\/vs\/client\.ts#L212" title="src\/vs\/client\.ts"[^>]*>client\.ts:212<\/a>\)/);
	// An absolute path is not in the repo, so it is shown but not linked.
	assert.match(c, /at <span class="err-loc" title="\/abs\/out\/cache\.js">cache\.js:538<\/span>/);
	assert.doesNotMatch(c, /no stack here/);
});

test('renderReportHtml keeps every error in the prompt, stack or not', () => {
	const text = promptText(renderReportHtml(RICH, { base: '/runs/r1' }), 1);
	assert.match(text, /### Error output\n```\nError: get_column_profiles[\s\S]*?\n```\nLogged in \/runs\/r1\/logs\/app\.log \(Renderer\), 2× after each Retry\./);
	assert.match(text, /```\nWarning: no stack here\n```\nLogged in \/runs\/r1\/logs\/ext\.log \(Extension host\)\./);
	// Evidence, Error output, Likely cause, Regression test, Context.
	const order = ['### Evidence', '### Error output', '### Likely cause', '### Regression test (suggestion)', '### Context'].map(h => text.indexOf(h));
	assert.deepEqual(order, [...order].sort((a, b) => a - b));
	assert.ok(order.every(i => i !== -1));
});

test('renderReportHtml writes regression cases as a numbered list led by a type tag', () => {
	const html = renderReportHtml(RICH);
	const c = card(html, 1);
	const sep = ' <span class="rt-sep" aria-hidden="true">&middot;</span> ';
	assert.match(c, /<div class="rt-label">Suggested cases<\/div><ol class="rt-cases"><li>Retry after a timeout loads the summary\./);
	assert.ok(c.includes('<div class="rt-meta rt-row"><span class="rt-t rt-t-tint">Unit</span><span>Add to <a class="rt-file" href="https://github.com/posit-dev/positron/blob/abc1234/src/vs/test/cache.test.ts"'));
	assert.ok(c.includes(`>cache.test.ts</a>${sep}exists, covers chunking only</span></div>`));
	// A file the case says to create has nothing to link to.
	assert.ok(c.includes('<span class="rt-t rt-t-tint">E2E</span><span>Add to <span class="rt-file" title="test/e2e/tests/slow.test.ts">slow.test.ts</span>'));
	// Other tests lists only files the cases have not named, as a bulleted list with the same row.
	const others = c.slice(c.indexOf('Other tests that touch this code'));
	assert.match(others, /^Other tests that touch this code<\/div><ul class="rt-other"><li><div class="rt-meta rt-row"><span class="rt-t rt-t-tint">Unit<\/span><span><a class="rt-file"/);
	assert.ok(others.includes(`>client.test.ts</a>${sep}checks request shape only</span></div></li>`));
	assert.doesNotMatch(others, /already named above/);
	assert.doesNotMatch(c, /rt-level|rt-sugg|suggestion<\/span>/);
	const dir = card(renderReportHtml(RICH.replace('`test/e2e/tests/slow.test.ts` (new file)', '`test/e2e/tests/data-explorer/` (new file)')), 1);
	assert.ok(dir.includes('Add to <span class="rt-file" title="test/e2e/tests/data-explorer/">data-explorer/</span>'));
	// One case is still a numbered list.
	const second = card(html, 2);
	assert.match(second, /<div class="rt-label">Suggested case<\/div><ol class="rt-cases"><li>One case only\.<div class="rt-meta rt-row">/);
	assert.match(second, /1 missing case<\/span>/);
	assert.doesNotMatch(second, /Other tests/);
});

test('report CSS: regression test block has fixed sizes and a tint tag', () => {
	const html = renderReportHtml(RICH);
	assert.match(html, /\.rt-cases\{margin:0;padding-left:20px;font-size:14px;line-height:1\.6;/);
	assert.match(html, /\.rt-meta\{margin-top:3px;font-size:12\.5px;line-height:1\.55;color:var\(--muted\)\}/);
	assert.match(html, /\.rt-file\{font-family:var\(--mono\);font-size:12px;/);
	assert.match(html, /\.rt-t-tint\{padding:3px 5px;border-radius:4px;background:var\(--rt-tag-bg\);color:var\(--rt-tag-ink\)\}/);
	// Party's tag is lighter than the card, with ink text, so it does not blend in.
	assert.match(html, /--rt-tag-bg: #3A2F6B;\s*--rt-tag-ink: #F5F1FF;/);
});

test('renderReportHtml writes the regression cases into the prompt after the cause', () => {
	const text = promptText(renderReportHtml(RICH), 1);
	assert.match(text, new RegExp([
		'### Regression test \\(suggestion\\)',
		'- Retry after a timeout loads the summary\\. → add to src/vs/test/cache\\.test\\.ts \\(Unit\\)',
		'- A slow source offers no Retry\\. → add to test/e2e/tests/slow\\.test\\.ts \\(E2E\\)',
		'Other tests that touch this code: src/vs/test/client\\.test\\.ts \\(Unit\\)',
		'',
		'### Context',
	].join('\n')));
});

test('renderReportHtml shows screenshots only, labelled and sorted by step', () => {
	const html = renderReportHtml(RICH, { base: '/runs/r1' });
	const c = card(html, 1);
	assert.doesNotMatch(c, /logtile/);
	const shots = [...c.matchAll(/data-file="([^"]+)"/g)].map(m => m[1]);
	assert.deepEqual(shots, ['a.png', 'b.png', 'c.png']);
	// No caption line: the step is a tag on the thumbnail, named in its label,
	// and the full-size view links it back.
	assert.doesNotMatch(c, /<figcaption/);
	assert.match(c, /data-step="Step 2" data-step-href="#f1-s2" aria-label="Step 2 screenshot, view full size: The notice">.*?<span class="shot-step" aria-hidden="true">Step 2<\/span><\/a>/);
	assert.match(c, /data-step="Variant" aria-label="Variant screenshot, view full size: Five columns">.*?<span class="shot-step" aria-hidden="true">Variant<\/span>/);
	const text = promptText(html, 1);
	assert.match(text, /### Evidence\n- https:\/\/cdn\.example\/shots\/a\.png — Step 2: The notice\n- https:\/\/cdn\.example\/shots\/b\.png — Step 3: After Retry\n- https:\/\/cdn\.example\/shots\/c\.png — Variant: Five columns\n- \/runs\/r1\/logs\/app\.log/);
});

test('parseReport keeps the step of a shot the finding also embeds', () => {
	const r = parseReport(md([
		'## Findings', '',
		'| # | Finding | Severity |', '|---|---|---|', '| 1 | a claim | minor |',
		'', '### Finding 1: a claim', '',
		'![Step 4: the panel after the timeout, with no sparkline](https://cdn.example/shots/a.png)',
		'', '**Evidence**', '',
		'- [shots/a.png](https://cdn.example/shots/a.png) -- no sparkline',
	].join('\n')));
	const [shot] = r.findings[0].evidence;
	assert.equal(shot.step.label, 'Step 4');
	assert.equal(shot.caption, 'The panel after the timeout, with no sparkline');
});

test('renderReportHtml opens a passing coverage row on its steps, not a finding row', () => {
	const html = renderReportHtml(RICH);
	const cov = html.slice(html.indexOf('id="coverage"'));
	assert.match(cov, /<details class="cv cf-r cf-p" id="cv-row-\d+"><summary class="row coverage-grid"><span class="cov-scenario"><span class="cov-dot pass"[^>]*><\/span><span>pandas frame<\/span><\/span>[\s\S]*?<span class="cv-chev-cell"><svg class="cv-chev"[\s\S]*?<\/summary><div class="cv-steps"><ol class="steps"><li>Build <code class="cc" data-tip="Copy">df<\/code>\.<\/li>\n<li>Run <code class="cc" data-tip="Copy">%view df<\/code>\.<\/li><\/ol><\/div><\/details>/);
	// No steps, nothing to open.
	assert.match(cov, /<div class="row coverage-grid cf-r cf-p" id="cv-row-\d+"><span class="cov-scenario"><span class="cov-dot pass"[^>]*><\/span><span>polars frame<\/span>[\s\S]*?<span><\/span><\/div>/);
	// The finding link leads, and the row does not expand.
	assert.match(cov, /<div class="row coverage-grid cf-r cf-i" id="cv-row-1"><span class="cov-scenario"><span class="cov-dot issue"[^>]*><\/span><span>slow column<\/span><\/span><span class="cov-result"><a href="#f1" class="cv-f">Finding 1<\/a> &middot; Fails 3\/3<\/span>/);
	assert.doesNotMatch(cov, /Should not render/);
	assert.match(cov, /<span class="cov-head-scenario">Scenario<\/span><span>Result<\/span><span><\/span><\/div>/);
});

test('renderReportHtml puts a passing row\'s screenshot on its verify step, not in a column', () => {
	const html = renderReportHtml(RICH);
	const cov = html.slice(html.indexOf('id="coverage"'), html.indexOf('</section>', html.indexOf('id="coverage"')));
	assert.doesNotMatch(cov, /class="ref|Screenshot<\/span>/);
	// The finding's screenshot is on its card, so the row does not link it.
	assert.doesNotMatch(cov, /slow\.png/);
	// The icon trails the last step and opens the lightbox as a group of one.
	assert.match(cov, /<li><span class="st-v">Verify it loads\.<\/span> <span class="st-sep" aria-hidden="true">&middot;<\/span> <a class="st-ev" href="https:\/\/cdn\.example\/shots\/arrow\.png" data-lb="cv-\d+" data-caption="arrow frame" data-file="arrow\.png" aria-label="Screenshot for this step: arrow frame"><svg/);
	assert.doesNotMatch(cov, /Build <code>tbl<\/code>\. <span class="st-sep"/);
	// With no steps, the screenshot alone makes the row expandable.
	assert.match(cov, /<span>duckdb frame<\/span>[\s\S]*?<div class="cv-steps"><p class="cv-shot">Screenshot <span class="st-sep"[^>]*>&middot;<\/span> <a class="st-ev" href="https:\/\/cdn\.example\/shots\/duck\.png"/);
	assert.match(html, /querySelectorAll\('a\.shot,a\.st-ev\[data-lb\]'\)/);
});

test('renderReportHtml keeps Show all working over expandable rows', () => {
	const rows = Array.from({ length: 10 }, (_, i) => `| pass ${i} | fine | | 1. Step for ${i}. |`);
	const html = renderReportHtml(md([
		'## Coverage', '', '### Verified', '',
		'| Scenario | Result | Screenshot | Steps |', '|---|---|---|---|', ...rows, '',
	].join('\n')));
	const body = html.slice(html.indexOf('<body'));
	// The hidden rows stay siblings of the checkbox, which the CSS toggle needs.
	assert.equal((body.match(/<details class="cv cf-r cf-p cov-extra" id="cv-row-\d+">/g) || []).length, 6);
	assert.match(body, /<div class="cov-rows">\n<input type="checkbox" id="cov-all" class="cov-toggle"[^>]*>\n<details class="cv cf-r cf-p" id="cv-row-1">/);
});

test('report CSS lines up every coverage row on one Scenario | Result | chevron grid', () => {
	const html = renderReportHtml(RICH);
	assert.match(html, /\.coverage-grid\{grid-template-columns:minmax\(0,40fr\) minmax\(0,60fr\) 12px;padding:12px 20px\}/);
	assert.match(html, /\.cov-notrun\{grid-column:span 2;/);
	assert.match(html, /\.cov-scenario\{display:flex;align-items:flex-start;gap:13px;/);
	assert.match(html, /\.cov-head-scenario\{padding-left:21px\}/);
	// Not-run dots match the others now.
	assert.match(html, /\.cov-dot\.none\{background:var\(--dot-neutral\)\}/);
});

test('report CSS filters rows by the checked tab and keeps Show all to All', () => {
	const html = renderReportHtml(RICH);
	assert.match(html, /#cf-i:checked~\.cf-card \.cf-r:not\(\.cf-i\),#cf-p:checked~\.cf-card \.cf-r:not\(\.cf-p\),#cf-n:checked~\.cf-card \.cf-r:not\(\.cf-n\)\{display:none !important\}/);
	assert.match(html, /#cf-i:checked~\.cf-card \.cov-more,#cf-p:checked~\.cf-card \.cov-more,#cf-n:checked~\.cf-card \.cov-more\{display:none !important\}/);
	assert.match(html, /#cf-p:checked~\.cf-card details\.cov-extra\.cf-p\{display:block !important\}/);
	// Selected is ink, not an accent, and the focus ring sits off the label.
	assert.match(html, /\.cf-tab-n\{color:var\(--ink\);border-bottom-color:var\(--ink\)\}/);
	assert.match(html, /\.cf-tab-n\{outline:2px solid var\(--focus\);outline-offset:4px;/);
	assert.match(html, /\.cov-rows\{position:relative;margin-bottom:-1px;font-size:14px;line-height:1\.5\}/);
	assert.match(html, /\.cf-tab \.cf-cnt\{color:var\(--faint\);font-weight:400;margin-left:3px\}/);
	assert.match(html, /\.cf-tab \.cf-g\{visibility:hidden;font-weight:600;padding-right:3px\}/);
});

test('report CSS gives Professional a teal accent with an ink kicker, and leaves Party and the Run bar alone', () => {
	const html = renderReportHtml(RICH);
	assert.doesNotMatch(html, /#2F5F8A|#1E4466/i);
	assert.match(html, /--link: #2E6B5E;\n\t--link-hover: #1F5046;/);
	assert.match(html, /--focus: #2E6B5E;/);
	assert.match(html, /--eyebrow-color: var\(--ink\);/);
	assert.match(html, /--eyebrow-color: #FF6AC1;/);
	assert.match(html, /--link: #5CE1E6;/);
	assert.match(html, /--stage-1: #5E646C;/);
});

test('renderReportHtml fences an error in the prompt so a ``` line inside cannot close it', () => {
	const src = md([
		'## Findings', '', '### 1. Broke', '', '_Major · New · Reproduced 1/1_', '',
		'**Observed** x', '', '**Expected** y', '',
		'**Error output** -- `logs/a.log` | Renderer', '',
		'    Error: bad template', '    ```', '    tail',
	].join('\n'));
	const text = promptText(renderReportHtml(src), 1);
	assert.match(text, /\n````\nError: bad template\n```\ntail\n````/);
});

test('renderReportHtml links the PR in the header and the prompt, only when there is one', () => {
	const withPr = RICH.replace('`branch/name` | `abc1234`\n', '`branch/name` | `abc1234`\n\nPR: posit-dev/positron#1234\n');
	const html = renderReportHtml(withPr);
	assert.match(html, /<span class="kicker">Exploratory test<\/span><span class="bullet"><\/span><a class="pr-link" href="https:\/\/github\.com\/posit-dev\/positron\/pull\/1234" target="_blank" rel="noopener" title="Open the pull request on GitHub">PR #1234<svg[^>]*>[\s\S]*?<\/svg><\/a><code>branch\/name<\/code><code>abc1234<\/code><\/div>/);
	assert.match(promptText(html, 1), /### Context\nPR: https:\/\/github\.com\/posit-dev\/positron\/pull\/1234\nBranch: branch\/name\n/);
	assert.match(html, /\.pr-link\{font-weight:500;white-space:nowrap\}/);

	// No PR: nothing in its place, in the header or the prompt.
	const plain = renderReportHtml(RICH);
	assert.doesNotMatch(plain.slice(plain.indexOf('<body')), /pr-link|PR #|Local run/);
	assert.match(promptText(plain, 1), /### Context\nBranch: branch\/name\n/);
});

test('parseReport only takes a PR line that is a real owner/repo#number', () => {
	const pr = line => parseReport(md().replace('`abc1234`\n', `\`abc1234\`\n\n${line}\n`)).pr;
	assert.deepEqual(pr('PR: posit-dev/positron#16188'), { number: 16188, url: 'https://github.com/posit-dev/positron/pull/16188' });
	assert.deepEqual(pr('**PR:** `posit-dev/positron#7`'), { number: 7, url: 'https://github.com/posit-dev/positron/pull/7' });
	assert.equal(pr('PR: javascript:alert(1)#1'), undefined);
	assert.equal(pr('PR: evil.com/x/y#1'), undefined);
	assert.equal(pr('PR: none'), undefined);
	// A PR mentioned in a finding is not the report's PR.
	assert.equal(parseReport(md('## Findings', '', 'PR: posit-dev/positron#1')).pr, undefined);
});

test('finding: a shot a step cites reaches the gallery even when no Evidence bullet names it', () => {
	const html = renderReportHtml(md(
		'## Findings', '', '| # | Finding | Severity | Impact | Reproduction |', '|---|---|---|---|---|', '| 1 | a claim | major | blocks | 1/1 |', '',
		'### Finding 1: a claim', '', '**Repro** -- starting state: the panel closed', '',
		'1. VERIFY the panel opens -> PASS', '   Evidence: S01-01.png',
		'2. Click Retry.',
		'3. VERIFY it loads -> FAIL - Finding 1', '   Observed: empty', '   Evidence: S01-03.png', '',
		'**Evidence**', '', '- [shots/S01-03.png](shots/S01-03.png) -- Step 3: empty panel',
	));
	const card = html.slice(html.indexOf('<article id="f1"'), html.indexOf('</article>', html.indexOf('<article id="f1"')));
	const tiles = [...card.matchAll(/<figure><a class="shot" id="shot-f1-(\d)" href="([^"]+)"[^>]*data-step="([^"]+)"/g)].map(m => [m[1], m[2], m[3]]);
	assert.deepEqual(tiles, [['1', 'shots/S01-01.png', 'Step 1'], ['2', 'shots/S01-03.png', 'Step 3']]);
	assert.match(card, /<li id="f1-s1">[\s\S]*?data-open="shot-f1-1"/);
});

// S08, S09, S01 and S04 of a real ledger: two failing scenarios, two passing.
const TYPED = readFileSync(new URL('./fixtures/typed-steps.md', import.meta.url), 'utf8');

test('typed steps: every verify step carries its result, and no action does', () => {
	const html = renderReportHtml(TYPED);
	const count = re => (html.match(re) ?? []).length;
	assert.equal(count(/class="st-rs st-pass"/g), 4);
	assert.equal(count(/class="st-rs st-fail"/g), 4);
	// 8 verify steps in the fixture, and no result on any of its 9 actions.
	assert.equal(count(/class="st-rs /g), 8);
	assert.equal(count(/class="st-v"/g), 8);
});

const PHOTO = '<svg aria-hidden="true" width="1em" height="1em" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"><rect x="2" y="3" width="12" height="10" rx="1.5"></rect><path d="M2.5 11l3.5-3.5 3 3 2-2 2.5 2.5"></path></svg>';

test('typed steps: the finding card reads Verify PASS, action, Verify FAIL with its observation', () => {
	const html = renderReportHtml(TYPED);
	const card = html.slice(html.indexOf('<article id="f2"'), html.indexOf('</article>', html.indexOf('<article id="f2"')));
	const li = k => new RegExp(`<li id="f2-s${k}">([\\s\\S]*?)</li>`).exec(card)?.[1] ?? '';
	assert.equal(li(3), '<span class="st-v">Verify s00 to s13 have sparklines.</span><span class="st-rs st-pass">PASS</span>');
	assert.doesNotMatch(li(4), /st-v|st-rs/);
	assert.equal(li(5), '<span class="st-v">Verify the visible columns s62 to s79 get sparklines.</span>'
		+ '<span class="st-rs st-fail">FAIL</span> <span class="st-sep" aria-hidden="true">&middot;</span> '
		+ `<a class="st-ev" href="#shot-f2-1" data-open="shot-f2-1" aria-label="Screenshot for this step">${PHOTO}</a>`
		+ '<span class="st-obs">Observed: Only s62 has one.</span>');
	// The icon rides on verify steps only, and the card never names its own finding.
	const list = card.slice(card.indexOf('<ol class="repro-steps steps">'), card.indexOf('</ol>'));
	assert.doesNotMatch(list, /Finding 2/);
	assert.doesNotMatch(li(4), /st-ev/);
	// A shot the step names takes that step's number, and links back to it.
	assert.match(card, /id="shot-f2-1"[^>]*data-step="Step 5" data-step-href="#f2-s5"/);
	assert.match(card, /data-step="Step 7" data-step-href="#f2-s7"/);
	assert.match(html, /\.steps li:target\{background:var\(--st-target\)\}/);
});

test('typed steps: Observed stays off the steps when the card says it once', () => {
	const one = TYPED.replace('5. Verify the visible columns s62 to s79 get sparklines. -> FAIL (finding 2)', '5. Look at the visible columns.')
		.replace('   Observed: Only s62 has one.\n', '');
	const html = renderReportHtml(one);
	const card = html.slice(html.indexOf('<article id="f2"'));
	assert.doesNotMatch(card.slice(0, card.indexOf('</article>')), /st-obs/);
});

test('typed steps: a passing row puts its photo on the verify step it proves', () => {
	const cov = renderReportHtml(TYPED).split('id="coverage"')[1];
	// From the Screenshot column: the last verify step.
	assert.match(cov, /as before\.<\/span><span class="st-rs st-pass">PASS<\/span> <span class="st-sep" aria-hidden="true">&middot;<\/span> <a class="st-ev" href="shots\/01-df-open\.png"/);
	// From an `Evidence:` item in the cell: the step before it.
	assert.match(cov, /Continue&quot;\.<\/span><span class="st-rs st-pass">PASS<\/span> <span class="st-sep"[^>]*>&middot;<\/span> <a class="st-ev" href="shots\/04-slow-paused\.png"/);
	assert.doesNotMatch(cov, /Evidence:/);
	assert.match(cov, /<li>Watch for 35 s\.<\/li>/);
});

test('typed steps: the ledger grammar reads the same', () => {
	const r = parseReport(TYPED.replace('5. Verify the visible columns s62 to s79 get sparklines. -> FAIL (finding 2)',
		'5. VERIFY The visible columns s62 to s79 get sparklines. → FAIL · Finding 2'));
	const step = r.findings[1].steps[4];
	assert.equal(step.kind, 'verify');
	assert.equal(step.result, 'fail');
	assert.equal(step.finding, 2);
	assert.equal(step.html, 'Verify the visible columns s62 to s79 get sparklines.');
	assert.deepEqual(step.evidence, [{ href: 'shots/23-continue-visible-still-empty.png', file: '23-continue-visible-still-empty.png' }]);
});

test('typed steps: a plain step from an older run gets no invented result', () => {
	const old = md([
		'## Findings', '',
		'| # | Finding | Severity |', '|---|---|---|', '| 1 | a claim | minor |',
		'', '### Finding 1: a claim', '',
		'**Repro** -- starting state: x', '',
		'1. Open it.', '2. Check that it loads.', '3. confirm the dialog closes',
	].join('\n'));
	const r = parseReport(old);
	const html = renderReportHtml(old);
	assert.deepEqual(r.findings[0].steps.map(s => [s.kind, s.result]), [['action', null], ['verify', null], ['verify', null]]);
	assert.match(html, /<li id="f1-s2"><span class="st-v">Check that it loads\.<\/span><\/li>/);
	assert.match(html, /<li id="f1-s3"><span class="st-v">Confirm the dialog closes<\/span><\/li>/);
	assert.doesNotMatch(html, /class="st-rs /);
});

test('typed steps: the agent prompt writes results after an arrow', () => {
	const html = renderReportHtml(TYPED);
	const prompt = /<script type="text\/plain" id="prompt-f2"[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
	assert.match(prompt, /3\. Verify s00 to s13 have sparklines\. → PASS\n/);
	assert.match(prompt, /5\. Verify the visible columns s62 to s79 get sparklines\. → FAIL \(observed: Only s62 has one\.\)\n/);
	assert.match(prompt, /^PR: https:\/\/github\.com\/posit-dev\/positron\/pull\/1234$/m);
});

const LEDGER = readFileSync(new URL('./fixtures/ledger.md', import.meta.url), 'utf8');
const coverageOf = html => html.slice(html.indexOf('id="coverage"'), html.indexOf('</section>', html.indexOf('id="coverage"')));

test('ledger: parses scenarios, preconditions, typed steps and not-run rows', () => {
	const cov = parseLedger(LEDGER);
	assert.deepEqual(cov.exercised.map(r => `${r.id}:${r.status}:${r.finding ?? ''}`),
		['S01:pass:', 'S02:pass:', 'S03:pass:', 'S04:pass:', 'S05:pass:', 'S06:pass:', 'S08:fail:1', 'S09:fail:2']);
	const s03 = cov.exercised[2];
	assert.deepEqual(s03.pre.map(p => p.from), ['S02']);
	assert.match(s03.pre[0].howHtml, /opened with <code>%view edge<\/code>/);
	assert.deepEqual(cov.exercised[7].steps.map(s => s.result ?? 'action'), ['action', 'action', 'pass', 'action', 'fail', 'action', 'fail']);
	assert.deepEqual(cov.exercised[6].steps[2].evidence.map(e => e.href), ['shots/09-one12-unavailable.png', 'shots/07-slow12-unavailable.png']);
	assert.deepEqual(cov.notExercised.map(r => r.id), ['N01', 'N02', 'N05']);
	assert.equal(cov.notExercised[1].reasonHtml, 'Could not make value fetches slow: the slow-hash trick only slows profiling');
	// Environment is whole-run context for Run details, never a Coverage row.
	assert.doesNotMatch(JSON.stringify([cov.exercised, cov.notExercised]), /CDP 44987/);
	assert.match(cov.environment.join('\n'), /CDP 44987/);
});

test('ledger: reads the middle-dot and arrow forms the same as ASCII', () => {
	const cov = parseLedger([
		'## S01 · slow column', 'Status: fail · Finding 3', 'Result: Fails 3/3', '',
		'Steps:', '1. Run it.', '2. VERIFY The summary loads. → FAIL · Finding 3', '   Observed: Dots.', '',
		'## Not run', '- N01 · Positron web · Desktop build only',
	].join('\n'));
	assert.equal(cov.exercised[0].finding, 3);
	assert.equal(cov.exercised[0].steps[1].md, 'Verify the summary loads.');
	assert.equal(cov.exercised[0].steps[1].observed, 'Dots.');
	assert.equal(cov.notExercised[0].reasonHtml, 'Desktop build only');
	assert.equal(parseLedger('# Test ledger\n\n## Environment\n- x'), null);
});

test('ledger: Coverage and the Coverage tile come from the ledger, not the report tables', () => {
	const report = parseReport(TYPED, { ledger: LEDGER });
	assert.deepEqual(report.scenarios, { exercised: 8, pass: 6, issues: 2, notRun: 3 });
	const html = renderReportHtml(TYPED, { ledger: LEDGER });
	// The tile's number is every scenario, so the legend adds up to it.
	assert.match(html, /<div class="tile-label">Coverage<\/div><div class="tile-figure"><span class="tile-num">11<\/span><span class="unit">scenarios<\/span>/);
	const cov = coverageOf(html);
	// One table: no subheadings, no second table.
	assert.doesNotMatch(cov, /Exercised|Not exercised|<h3/);
	assert.match(cov, /cf-tab-all"><span class="cf-l">All <span class="cf-cnt">11<\/span>/);
	assert.match(cov, /cf-tab-i"><span class="cf-l">Failed <span class="cf-cnt">2<\/span>/);
	assert.match(cov, /cf-tab-p"><span class="cf-l">Passed <span class="cf-cnt">6<\/span>/);
	assert.match(cov, /cf-tab-n"><span class="cf-l">Not run <span class="cf-cnt">3<\/span>/);
	// Issues in finding order, then passes in run order, then not run.
	const order = [...cov.matchAll(/id="cv-row-(\d+)"[\s\S]*?<span class="cov-dot (\w+)"[^>]*><\/span><span>([^<]+)/g)].map(m => `${m[1]}:${m[2]}:${m[3]}`);
	assert.deepEqual(order.map(o => o.split(':').slice(0, 2).join(':')), [
		'1:issue', '2:issue', '3:pass', '4:pass', '5:pass', '6:pass', '7:pass', '8:pass', '9:none', '10:none', '11:none',
	]);
	assert.match(cov, /<a href="#f1" class="cv-f">Finding 1<\/a> &middot; Fails 3\/3/);
	// Two passes past the first four wait behind Show all, which counts every row.
	assert.equal((cov.match(/cov-extra/g) || []).length, 2);
	assert.match(cov, /<span class="cov-all">Show all 11 scenarios<\/span><span class="cov-less">Show fewer<\/span>/);
	assert.doesNotMatch(cov, /Everything in scope was exercised/);
});

test('ledger: a finding row links every finding its steps failed on, not just its first', () => {
	const ledger = LEDGER.replace('5. VERIFY The summary loads after Retry. -> FAIL - Finding 1', '5. VERIFY The summary loads after Retry. -> FAIL - Finding 2');
	const cov = coverageOf(renderReportHtml(TYPED, { ledger }));
	assert.match(cov, /<a href="#f1" class="cv-f">Finding 1<\/a> &middot; <a href="#f2" class="cv-f">Finding 2<\/a> &middot; Fails 3\/3/);
});

test('ledger: an expanded row shows P plus short names, with the how-to in a popover', () => {
	const cov = coverageOf(renderReportHtml(TYPED, { ledger: LEDGER }));
	const row = /<details class="cv cf-r cf-p" id="cv-row-5">[\s\S]*?<\/details>/.exec(cov)[0];
	assert.match(row, /<span>Expand on a healthy source<\/span>/);
	assert.match(row, /<div class="cv-steps"><p class="cv-pre" tabindex="0" aria-label="Preconditions"><span class="pre-mark" aria-hidden="true">P<\/span><code>edge<\/code> open<span class="pre-pop" role="tooltip"><span class="pre-t">Preconditions<\/span><span class="pre-i"><b><code>edge<\/code> open<\/b>Created in <a href="#cv-row-4">Edge values/);
	assert.doesNotMatch(row, /<ul/);
	// Not-created state has no "Created in".
	const s04 = /<details class="cv cf-r cf-p" id="cv-row-6">[\s\S]*?<\/details>/.exec(cov)[0];
	assert.match(s04, /<b><code>slow\.py<\/code> loaded<\/b>Run <code>%run -i slow\.py<\/code>/);
	assert.doesNotMatch(s04, /Created in/);
	// No preconditions, no P line.
	const s01 = /<details class="cv cf-r cf-p" id="cv-row-3">[\s\S]*?<\/details>/.exec(cov)[0];
	assert.doesNotMatch(s01, /cv-pre/);
	assert.match(s01, /<span class="st-rs st-pass">PASS<\/span> <span class="st-sep" aria-hidden="true">&middot;<\/span> <a class="st-ev" href="shots\/01-df-open\.png"/);
});

test('ledger: nothing not run means no Not run tab and a line saying so', () => {
	const ledger = LEDGER.slice(0, LEDGER.indexOf('## Not run'));
	const cov = coverageOf(renderReportHtml(TYPED, { ledger }));
	assert.doesNotMatch(cov, /cf-tab-n|id="cf-n"|cf-r cf-n/);
	assert.match(cov, /<p class="cov-empty">Everything in scope was exercised\.<\/p>/);
});

test('report CSS: expanded rows tint the header only, number steps in the gutter, and let popovers out', () => {
	const html = renderReportHtml(TYPED, { ledger: LEDGER });
	assert.match(html, /\.cv\[open\]>summary\{background:var\(--cv-open\);position:relative\}/);
	assert.match(html, /\.cv\[open\]>summary::after\{content:"";position:absolute;left:41px;right:20px;bottom:0;height:1px;background:var\(--border\)\}/);
	assert.match(html, /\.cv-steps ol>li\{position:relative;margin:0 0 2px;padding-left:0;counter-increment:st\}/);
	assert.match(html, /\.cv-steps ol>li::before\{content:counter\(st\);display:inline-block;width:20px;margin:0 7px 0 -27px;/);
	assert.match(html, /\.cv-pre \.pre-mark\{display:inline-block;width:20px;margin:0 7px 0 -27px;/);
	assert.match(html, /\.cf-card\{overflow:visible\}/);
	// The P popover triggers on the P and names only, opens upward, and waits out a passing mouse.
	assert.match(html, /\.cv-pre\{position:relative;width:fit-content;/);
	assert.match(html, /\.pre-pop\{position:absolute;bottom:calc\(100% \+ 6px\);[^}]*visibility:hidden;opacity:0;/);
	assert.match(html, /\.cv-pre:hover \.pre-pop\{visibility:visible;opacity:1;transition:opacity \.12s ease \.15s,visibility 0s linear \.15s\}/);
	assert.match(html, /\.cv-pre:focus \.pre-pop,\.cv-pre:focus-within \.pre-pop\{visibility:visible;opacity:1;transition:none\}/);
	assert.doesNotMatch(html, /\.pre-pop\{[^}]*display:none/);
	assert.match(html, /\.st-v\{color:inherit\}/);
	// The finding link's underline is Professional's alone.
	assert.match(html, /:root\[data-theme=professional\] \.cv-f\{text-decoration:underline;/);
	assert.doesNotMatch(html, /^\.cv-f\{text-decoration/m);
});

test('finding steps: a step with two shots shows the icon with a count', () => {
	const html = renderReportHtml(md([
		'## Findings', '', '| # | Finding | Severity |', '|---|---|---|', '| 1 | a claim | minor |', '',
		'### Finding 1: a claim', '', '**Repro** -- starting state: nothing', '', '1. Open it.', '2. Verify it loads. -> FAIL (finding 1)', '',
		'**Evidence**', '',
		'- [shots/a.png](https://cdn.example/shots/a.png) -- Step 2: first',
		'- [shots/b.png](https://cdn.example/shots/b.png) -- Step 2: second',
	].join('\n')));
	assert.match(html, /<a class="st-ev" href="#shot-f1-1" data-open="shot-f1-1" aria-label="2 screenshots for this step"><svg[\s\S]*?<\/svg><span class="st-n">2<\/span><\/a>/);
	assert.doesNotMatch(/<li id="f1-s1">.*?<\/li>/.exec(html)[0], /st-ev/);
});

test('lightbox: the caption names the step and links it; the copy button shows the copy icon', () => {
	const html = renderReportHtml(TYPED);
	assert.match(html, /st\.className='lb-step'/);
	assert.match(html, /\.lb-step\{font-weight:600;color:var\(--ink\);text-decoration:none\}/);
	assert.match(html, /\.shot-step\{position:absolute;left:8px;bottom:8px;font-size:10\.5px;font-weight:500;[^}]*color:var\(--shot-step-text\);border:1px solid var\(--shot-step-border\)/);
	assert.match(html, /<svg class="cp-ico"[^>]*><rect x="5\.5" y="5\.5" width="8" height="8" rx="1\.6"><\/rect>/);
	assert.doesNotMatch(html, /M7 3c\.35 2\.7/);
});

test('coverage: a scenario name reaches the photo caption as plain text', () => {
	const html = renderReportHtml(md([
		'## Coverage', '', '### Verified', '',
		'| Scenario | Result | Screenshot |', '|---|---|---|',
		'| **Bold** `code` [link](https://x.example) & more | ok | [shots/a.png](https://cdn.example/shots/a.png) |',
	].join('\n')));
	assert.match(html, /data-caption="Bold code link &amp; more"/);
});

test('typed steps: a step Log line reaches the agent prompt', () => {
	const html = renderReportHtml(TYPED);
	assert.match(html, /\n\s*Log: get_column_profiles timed out after 10 seconds \(Renderer, 2x\)/);
});

const FENCED = TYPED.replace(
	'1. Run `one12 = make_slow(ncols=1, nrows=1000, delay=0.012)`. One string column whose frequency table takes about 13 s.',
	'1. In the Python console, make a one-column table:\n\n   ```python\n   %run -i slow.py\n   one12 = make_slow(ncols=1, nrows=1000, delay=0.012)\n   ```',
);

test('code blocks: a fenced step block gets a hover copy button that copies only the code', () => {
	assert.notEqual(FENCED, TYPED);
	const html = renderReportHtml(FENCED);
	assert.match(html, /<li id="f1-s1">In the Python console, make a one-column table:\s*<div class="code-blk"><pre><code[^>]*>%run -i slow\.py\none12 = make_slow\(ncols=1, nrows=1000, delay=0\.012\)<\/code><\/pre><button type="button" class="code-cp" data-tip="Copy code" aria-label="Copy code"><svg class="cp-ico" aria-hidden="true" width="14" height="14"[\s\S]*?<svg class="cp-ok" aria-hidden="true" width="14" height="14"[\s\S]*?<\/button><\/div>\s*<\/li>/);
	assert.match(html, /querySelectorAll\('\.cp-btn,\.code-cp'\)/);
	assert.match(html, /text=pre\.textContent;/);
	assert.match(html, /\.code-cp\{position:absolute;top:7px;right:7px;width:26px;height:26px;[^}]*opacity:0;/);
	assert.match(html, /\.code-blk:hover \.code-cp,\.code-blk:focus-within \.code-cp,\.code-cp\.is-copied\{opacity:1\}/);
	assert.match(html, /@media \(hover:none\)\{\.code-cp\{opacity:\.8\}\}/);
	assert.match(html, /--code-blk-bg: #F1EFEA;/);
	assert.match(html, /--code-blk-bg: #19132F;/);
});

test('code blocks: the copy script ships for code blocks even with agent prompts off', () => {
	const html = renderReportHtml(FENCED, { agentPrompts: false });
	assert.doesNotMatch(html, /class="cp-btn"/);
	assert.match(html, /class="code-cp"/);
	assert.match(html, /querySelectorAll\('\.cp-btn,\.code-cp'\)/);
	assert.doesNotMatch(renderReportHtml(TYPED, { agentPrompts: false }), /\.cp-btn,\.code-cp/);
});

test('code blocks: a fenced block under a ledger step gets the copy button in Coverage', () => {
	const ledger = [
		'# Test ledger', '', '## Environment', '- desktop', '', '---', '',
		'## S01 - Paced loading', 'Status: pass', 'Result: loads', '', 'Steps:',
		'1. Load the slow source:', '', '   ```python', '   %run -i slow.py', '   slow = make_slow()', '   ```',
		'2. VERIFY it loads -> PASS', '',
	].join('\n');
	const cov = coverageOf(renderReportHtml(TYPED, { ledger }));
	assert.match(cov, /<div class="code-blk"><pre><code[^>]*>%run -i slow\.py\nslow = make_slow\(\)\n?<\/code><\/pre><button type="button" class="code-cp"/);
});

const LOGS_DIR = new URL('./fixtures/logs-run/', import.meta.url);
const LOGS_REPORT = readFileSync(new URL('report.md', LOGS_DIR), 'utf8');
const LOGS_LEDGER = readFileSync(new URL('ledger.md', LOGS_DIR), 'utf8');
const logsHtml = (options = {}) => renderReportHtml(LOGS_REPORT, { ledger: LOGS_LEDGER, base: '/runs/r2', ...options });

test('logs: the ledger reads its Logs section and a Log field with the stack under it', () => {
	const ledger = parseLedger(LOGS_LEDGER);
	assert.deepEqual(ledger.logs.map(l => l.path), ['logs/44987-app.log', 'logs/exthost.log', 'logs/python-console.log']);
	assert.equal(ledger.logs[0].source, 'Positron window (renderer and dev-tools console)');
	const step = ledger.exercised.find(r => r.id === 'S08').steps[2];
	assert.equal(step.error.source, 'logs/44987-app.log:1182');
	assert.deepEqual(step.error.meta, ['Renderer', 'Logged 2x (after each Retry)']);
	assert.equal(step.error.count, 2);
	assert.equal(step.error.frames.length, 3);
	// The stack is the Log's, not a block under the step.
	assert.equal(step.blockHtml, '');
	assert.equal(parseLedger('## S01 - x\nSteps:\n1. VERIFY y -> FAIL - Finding 1\n   Log: none found in logs/a.log\n').exercised[0].steps[0].error, null);
});

test('logs: the Error output row links the log by path, with the line only in the text', () => {
	const c = card(logsHtml(), 1);
	assert.match(c, /<a href="logs\/44987-app\.log" class="log-link err-src" title="Open the full log"[^>]*>logs\/44987-app\.log:1182<\/a><span>Renderer<\/span><span>Logged 2× \(after each Retry\)<\/span>/);
	const hrefs = [...logsHtml().matchAll(/href="(logs\/[^"]*)"/g)].map(m => m[1]);
	assert.ok(hrefs.length > 0);
	for (const href of hrefs) {
		assert.ok(existsSync(new URL(href, LOGS_DIR)), `${href} exists`);
	}
	assert.doesNotMatch(logsHtml(), /href="(\/(?!#)|~|\/tmp)/);
	// Logs never join the screenshot gallery.
	for (const m of logsHtml().matchAll(/<div class="shots">([\s\S]*?)<\/div><\/div>/g)) {
		assert.doesNotMatch(m[1], /\.log\b/);
	}
});

test('logs: a bare-message Log gets no card row but reaches the prompt', () => {
	const html = logsHtml();
	assert.doesNotMatch(card(html, 2), /Error output/);
	assert.match(promptText(html, 2), /Warning: profile request for s63 cancelled/);
});

test('logs: the prompt carries the absolute log line in Evidence and the stack verbatim', () => {
	const text = promptText(logsHtml(), 1);
	assert.match(text, /### Evidence\n[\s\S]*- \/runs\/r2\/logs\/44987-app\.log:1182 — “Error: get_column_profiles timed out after 10 seconds” \(Renderer, 2× after each Retry\)\n/);
	assert.match(text, /```\nError: get_column_profiles timed out after 10 seconds\n {2}at DataExplorerClient\.getColumnProfiles \(languageRuntimeDataExplorerClient\.ts:212\)\n {2}at TableSummaryCache\.loadColumnProfiles/);
	assert.match(text, /\n```\nLogged in \/runs\/r2\/logs\/44987-app\.log:1182 \(Renderer\), 2× after each Retry\./);
});

test('logs: Run details lists the ledger and one row per log, before Branch verification', () => {
	const html = logsHtml();
	const folds = html.slice(html.indexOf('id="run-details"'));
	const labels = [...folds.matchAll(/<div class="fold-label">([^<]+)<\/div>/g)].map(m => m[1]);
	assert.deepEqual(labels, ['Agents', 'Change under test', 'Environment', 'State manipulation', 'Test ledger', 'Logs', 'Test files', 'Branch verification']);
	assert.match(folds, /recorded as the run went: <a href="ledger\.md" class="log-file">ledger\.md<\/a>/);
	const rows = /<ul class="log-list">([\s\S]*?)<\/ul>/.exec(folds)[1].match(/<li>/g);
	assert.equal(rows.length, parseLedger(LOGS_LEDGER).logs.length);
	assert.ok(folds.includes('<li><a href="logs/exthost.log" class="log-file" title="Open the full log" target="_blank" rel="noreferrer">logs/exthost.log</a> <span class="log-sep" aria-hidden="true">&middot;</span> <span class="log-note">Extension host</span> <span class="log-sep" aria-hidden="true">&middot;</span> <span class="log-note">no errors</span></li>'));
});

test('logs: a listed file that is missing is shown unlinked, and a folder never links', () => {
	const html = renderReportHtml(LOGS_REPORT, {
		ledger: `${LOGS_LEDGER}\n`.replace('## Logs\n', '## Logs\n- logs/all/44987/ | Every log | artifact only\n'),
		fileExists: p => p !== 'logs/exthost.log',
	});
	assert.match(html, /<span class="log-file">logs\/exthost\.log<\/span>/);
	assert.match(html, /<span class="log-file">logs\/all\/44987\/<\/span>/);
	assert.doesNotMatch(html, /href="logs\/(exthost\.log|all)/);
});

test('logs: render.mjs fails the run when a listed log was not copied', () => {
	const dir = mkdtempSync(join(tmpdir(), 'logs-run-'));
	cpSync(fileURLToPath(LOGS_DIR), dir, { recursive: true });
	const render = () => spawnSync(process.execPath, [fileURLToPath(new URL('./render.mjs', import.meta.url)), join(dir, 'report.md')], { encoding: 'utf8' });
	assert.equal(render().status, 0);
	rmSync(join(dir, 'logs', 'python-console.log'));
	const failed = render();
	assert.equal(failed.status, 1);
	assert.match(failed.stderr, /logs\/python-console\.log/);
	assert.ok(existsSync(join(dir, 'index.html')));
	rmSync(dir, { recursive: true, force: true });
});

test('Run details shows the explorer\'s format checks, with the rules it did not fix marked', () => {
	const page = checks => renderReportHtml(LOGS_REPORT, {
		readFile: p => (p === 'format-checks.jsonl' ? Buffer.from(checks.map(c => JSON.stringify(c)).join('\n')) : null),
		fileExists: p => p === 'stats.json',
	});
	const blank = 'report: leave a blank line after </summary>';
	const repro = 'report: finding # Reproduction must be N/M, got "…"';
	const shot = 'ledger: S# step # VERIFY has no Evidence: naming a screenshot in shots/; every check gets its own';

	// Of three: the blank line fixed, one of two Reproductions left, and a
	// screenshot rule that broke after the first check.
	const html = page([
		{ problems: 3, rules: { [blank]: 1, [repro]: 2 } },
		{ problems: 2, rules: { [repro]: 1, [shot]: 1 } },
	]);
	assert.match(html, /<div class="format-checks">The explorer ran the report's format check 2 times\. The first time, it found 3 problems:<\/div><ul class="format-rules">/);
	assert.match(html, /<\/ul><div class="format-raw"><a href="stats.json">Raw stats<\/a><\/div>/);
	// Not fixed first, escaped, then the fixed one; a partial fix shows both counts.
	assert.match(html, new RegExp([
		'<ul class="format-rules">',
		'<li><span class="num">2&times;</span> report: finding # Reproduction must be N/M, got &quot;…&quot; <span class="fixed">1 fixed</span> <span class="not-fixed">1 not fixed</span></li>',
		'<li><span class="num">1&times;</span> ledger: S# step # VERIFY has no Evidence: naming a screenshot in shots/; every check gets its own <span class="not-fixed">not fixed</span></li>',
		'<li><span class="num">1&times;</span> report: leave a blank line after &lt;/summary&gt; <span class="fixed">fixed</span></li>',
		'</ul>',
	].join('').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

	// All fixed: every rule marked fixed, none not fixed.
	const clean = page([{ problems: 2, rules: { [blank]: 2 } }, { problems: 0, rules: {} }]);
	assert.match(clean, /report: leave a blank line after &lt;\/summary&gt; <span class="fixed">fixed<\/span>/);
	assert.doesNotMatch(clean, /class="not-fixed"/);
	// One clean check: the sentence, and no list.
	const once = page([{ problems: 0, rules: {} }]);
	assert.match(once, /format check once\. The first time, it found no problems\./);
	assert.doesNotMatch(once, /<ul class="format-rules">/);
	assert.doesNotMatch(renderReportHtml(LOGS_REPORT), /Format checks/);
});

test('render.mjs writes the explore and verify passes and their total, replacing an earlier footer', () => {
	const dir = mkdtempSync(join(tmpdir(), 'logs-run-'));
	cpSync(fileURLToPath(LOGS_DIR), dir, { recursive: true });
	const report = join(dir, 'report.md');
	const render = args => spawnSync(process.execPath, [fileURLToPath(new URL('./render.mjs', import.meta.url)), report, ...args], { encoding: 'utf8' });
	render(['--model', 'claude-opus-5-5', '--duration-ms', '1500000', '--turns', '142']);
	render(['--model', 'claude-opus-5-5', '--duration-ms', '1500000', '--turns', '142', '--verify-model', 'claude-sonnet-5', '--verify-duration-ms', '180000', '--verify-turns', '24']);
	const footer = readFileSync(report, 'utf8').trimEnd().split('\n').slice(-3);
	assert.deepEqual(footer, ['_explore: Opus 5.5 | 142 turns | 25m_', '_verify: Sonnet 5 | 24 turns | 3m_', '_total: 28m_']);
	const { cost } = parseReport(readFileSync(report, 'utf8'));
	assert.deepEqual(cost.passes.map(p => p.label), ['explore', 'verify']);
	assert.equal(cost.duration, '28m');
	rmSync(dir, { recursive: true, force: true });
});

test('render.mjs keeps a verify pass that took under a millisecond', () => {
	const dir = mkdtempSync(join(tmpdir(), 'logs-run-'));
	cpSync(fileURLToPath(LOGS_DIR), dir, { recursive: true });
	const report = join(dir, 'report.md');
	spawnSync(process.execPath, [fileURLToPath(new URL('./render.mjs', import.meta.url)), report, '--duration-ms', '60000', '--verify-model', 'claude-sonnet-5', '--verify-duration-ms', '0']);
	assert.match(readFileSync(report, 'utf8'), /_verify: Sonnet 5 \| <1m_\n_total: 1m_\n$/);
	rmSync(dir, { recursive: true, force: true });
});

test('modelDisplayName reads a model id the way the report names it', () => {
	assert.equal(modelDisplayName('claude-opus-5-5'), 'Opus 5.5');
	assert.equal(modelDisplayName('claude-sonnet-5'), 'Sonnet 5');
	assert.equal(modelDisplayName('claude-haiku-4-5-20251001'), 'Haiku 4.5');
	assert.equal(modelDisplayName('claude-opus-5-5[1m]'), 'Opus 5.5');
	assert.equal(modelDisplayName('some-other-model'), 'some-other-model');
	assert.equal(modelDisplayName(null), null);
});

test('derived: a finding with no status strip takes its state from the table row', () => {
	const bare = TYPED.split('\n').filter(l => !l.startsWith('> ')).join('\n');
	const [f] = parseReport(bare).findings;
	assert.equal(f.confirmed, 'Confirmed');
	assert.equal(f.reproduced, '3/3');
	const unproven = parseReport(bare.replace(/\| 3\/3 \|/, '| 0/3 |')).findings[0];
	assert.equal(unproven.confirmed, 'Unproven');
});

test('derived: Run details shows the ledger Environment after Change under test', () => {
	const env = s => s.find(p => p.title === 'Environment');
	assert.match(env(parseReport(TYPED, { ledger: LEDGER }).runDetails).html, /CDP 44987/);
	const folded = `${TYPED}\n<details>\n<summary>Run details</summary>\n\n### Change under test\nx\n\n### Branch verification\ny\n\n</details>\n`;
	assert.deepEqual(parseReport(folded, { ledger: LEDGER }).runDetails.map(s => s.title), ['Change under test', 'Environment', 'Branch verification']);
	// A report that wrote its own keeps it.
	const own = folded.replace('### Branch verification', '### Environment\nmine\n\n### Branch verification');
	const sections = parseReport(own, { ledger: LEDGER }).runDetails;
	assert.equal(sections.filter(s => s.title === 'Environment').length, 1);
	assert.match(env(sections).html, /mine/);
});

test('parseReport: a heading inside an indented code block does not end the section', () => {
	const { findings } = parseReport([
		'# Exploratory test: x', '', '## Findings', '',
		'| # | Finding | Severity |', '|---|---|---|', '| 1 | one | minor |', '| 2 | two | minor |', '',
		'### Finding 1: one', '', '**Repro** -- starting state: this file', '', '    ## Setup', '    x <- 1', '', '1. Open it.', '',
		'### Finding 2: two', '', '**Repro** -- starting state: nothing', '', '1. Open it.', '',
	].join('\n'));
	assert.deepEqual(findings.map(f => f.n), [1, 2]);
	assert.equal(findings[0].steps.length, 1);
	assert.match(findings[0].preconditions[0], /<pre><code>## Setup\nx &lt;- 1\n<\/code><\/pre>/);
});

test('parseReport: a fence marker indented four spaces does not close the Repro block', () => {
	const { findings } = parseReport([
		'# Exploratory test: x', '', '## Findings', '',
		'| # | Finding | Severity |', '|---|---|---|', '| 1 | one | minor |', '',
		'### Finding 1: one', '', '**Repro** -- starting state: this file', '',
		'```md', 'a', '    ```', 'b', '```', '', '1. Open it.', '',
	].join('\n'));
	assert.equal(findings[0].steps.length, 1);
	assert.match(findings[0].preconditions[0], /a\n {4}```\nb/);
});

const STACKED = md([
	'## Findings', '',
	'| # | Finding | Severity | Reproduction |', '|---|---|---|---|',
	'| 1 | a claim | major | 3/3 |',
	'',
	'### Finding 1: A column never loads',
	'',
	'**Repro**',
	'',
	'1. Open it.',
	'2. Wait.',
	'3. VERIFY a notice offers Retry -> PASS',
	'4. Click Retry.',
	'5. VERIFY it loads -> FAIL (finding 1)',
	'',
	'**Evidence**',
	'',
	'- [shots/a.png](shots/a.png) -- Step 3: after Retry',
	'- [shots/c.png](shots/c.png) -- Step 5: still empty',
	'- [shots/b.png](shots/b.png) -- Step 3: the notice again',
].join('\n'));

test('renderReportHtml stacks the screenshots of one step into one tile', () => {
	const c = card(renderReportHtml(STACKED), 1);
	const tiles = c.match(/<figure>/g) ?? [];
	assert.equal(tiles.length, 2);
	// The stack opens its first shot and says how many it holds.
	assert.match(c, /<a class="shot stk" id="shot-f1-1" href="shots\/a\.png" data-lb="f1-g1"[^>]*aria-label="Step 3: 2 screenshots, view full size">/);
	assert.match(c, /<span class="shot-step" aria-hidden="true">Step 3<span class="shot-n">2<\/span><\/span>/);
	// The rest of the stack stays reachable by id, in the stack's own group.
	assert.match(c, /<a class="shot" id="shot-f1-2" href="shots\/b\.png" data-lb="f1-g1"[^>]*hidden><\/a>/);
	// A step with one shot renders as before, with no count.
	assert.match(c, /<a class="shot" id="shot-f1-3" href="shots\/c\.png" data-lb="f1-g2"[^>]*aria-label="Step 5 screenshot, view full size: Still empty">/);
	assert.doesNotMatch(c.slice(c.indexOf('id="shot-f1-3"')), /shot-n/);
	// The step icon still opens the step's first shot.
	assert.match(c, /data-open="shot-f1-1" aria-label="2 screenshots for this step"/);
});

test('renderReportHtml pages a stack in the lightbox without wrapping', () => {
	const html = renderReportHtml(STACKED);
	assert.match(html, /<div class="lb-img"><img alt="">\n<button type="button" class="lb-nav lb-prev" hidden>/);
	assert.match(html, /function show\(i\)\{if\(i<0\|\|i>=group\.length\)\{return;\}/);
	assert.match(html, /pos\.textContent=\(at\+1\)\+' \/ '\+group\.length/);
	assert.match(html, /<\/div>\n<span class="lb-pos" hidden><\/span>\n<button type="button" class="lb-close"/);
	assert.doesNotMatch(html, /lb-dots/);
	assert.doesNotMatch(html, /\.shot\.stk::after/);
	assert.match(html, /a\.shot\[hidden\]\{display:none\}/);
});

// ---- File a GitHub issue --------------------------------------------------

const issueBlock = (html, n) => {
	const m = new RegExp(`<script type="text/plain" id="issue-f${n}">([\\s\\S]*?)</script>`).exec(html);
	return m ? m[1] : null;
};
const issueAnchor = (html, n) => new RegExp(`<a class="gh-btn"[^>]*aria-label="File a GitHub issue for finding ${n} [^"]*">`).exec(html)?.[0];
const unescapeHtml = s => s.replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const issueUrl = (html, n) => new URL(unescapeHtml(/href="([^"]*)"/.exec(issueAnchor(html, n))[1]));
// What the page's copy handler hands the clipboard.
const issueCopied = (html, n) => issueBlock(html, n).replace(/<\\(?=\/script|!--)/gi, '<');
const logsRead = p => {
	try { return readFileSync(new URL(p, LOGS_DIR)); } catch { return null; }
};
const logsIssueHtml = (options = {}) => logsHtml({ base: 'https://cdn.example/run1', readFile: logsRead, ...options });

test('issue: one button per card, directly before Copy prompt', () => {
	for (const html of [renderReportHtml(FULL), logsIssueHtml()]) {
		for (const card of html.split('<article id="f').slice(1)) {
			assert.equal((card.match(/class="gh-btn"/g) || []).length, 1);
			assert.match(card, /<\/svg><\/a><button type="button" class="cp-btn"/);
		}
	}
	const off = renderReportHtml(FULL, { agentPrompts: false });
	assert.match(off, /class="gh-btn"[^>]*>[\s\S]*?<\/a><\/div>/);
});

test('issue: the link opens a blank bug form titled as the card, with the embedded text as its body', () => {
	const html = logsIssueHtml();
	for (const n of [1, 2]) {
		const title = unescapeHtml(new RegExp(`<article id="f${n}"[\\s\\S]*?<h2 class="card-title">([^<]*)</h2>`).exec(html)[1]);
		const url = issueUrl(html, n);
		assert.equal(`${url.origin}${url.pathname}`, 'https://github.com/posit-dev/positron/issues/new');
		assert.equal(url.searchParams.get('title'), title);
		assert.equal(url.searchParams.get('labels'), 'ai-discovered');
		assert.equal(url.searchParams.get('template'), null);
		assert.equal(url.searchParams.get('body'), issueCopied(html, n));
		assert.ok(url.href.length <= 8000);
		assert.match(issueAnchor(html, n), / target="_blank" rel="noopener" data-tip="File a GitHub issue"/);
		assert.doesNotMatch(issueAnchor(html, n), /data-issue/);
	}
});

test('issue: the body follows the template and leaves out what triage sets', () => {
	const body = issueCopied(logsIssueHtml(), 1);
	const headings = [...body.matchAll(/^## (.+)$/gm)].map(m => m[1]);
	assert.deepEqual(headings, ['System details', 'Describe the issue', 'Steps to reproduce', 'Expected', 'Actual', 'Error messages', 'Evidence']);
	assert.match(body, /^<sub>Reported by \[exploratory test\]\(https:\/\/cdn\.example\/run1\/index\.html#f1\) of #1234 \(`[^`]+` @ `[0-9a-f]+`\)<\/sub>\n/);
	assert.ok(body.includes([
		'**Positron and OS:**  ',
		'Positron 2026.10.0 build 12 (dev build of `ed2487a1a2`)  ',
		'Ubuntu 22.04, Linux x64',
		'',
		'**Session:**  ',
		'Python 3.10.12 with pandas, polars, duckdb and pyarrow',
	].join('\n')));
	assert.doesNotMatch(body, /Code - OSS|Please investigate|### Context|!\[|Severity|Status:|Reproduced|Major|Coverage/i);
	assert.match(body, /^- `slow\.py` \(below\) loaded/m);
	assert.match(body, /^3\. Verify the column summary loads\. → \*\*FAIL\*\*/m);
	assert.doesNotMatch(body, /^\s*Log:/m);
	assert.match(body, /## Error messages\n```\nError: get_column_profiles timed out/);
	assert.match(body, /^Screenshots and logs are in the \[exploratory test\]\(https:\/\/cdn\.example\/run1\/index\.html#f1\) report for this run\.$/m);
	assert.doesNotMatch(body, /09-one12-unavailable\.png/);
	// The bullets say what they are.
	assert.doesNotMatch(body, /Preconditions/);
	assert.match(body, /## Steps to reproduce\n- `slow\.py` \(below\) loaded[^\n]*\n\n1\. /);
	assert.match(body, /<details><summary>slow\.py<\/summary>\n\n```python\n# slow\.py/);
	assert.doesNotMatch(body, /\/runs\/|\/tmp\//);
});

test('issue: an error longer than six lines is clipped, and a run without one says so', () => {
	const long = LOGS_REPORT.replace(/(\n\s+at TableSummaryCache\.retryColumnProfiles[^\n]*)/, '$1$1$1$1$1');
	const body = issueCopied(renderReportHtml(long, { ledger: LOGS_LEDGER, readFile: logsRead }), 1);
	const fence = /## Error messages\n```\n([\s\S]*?)\n```/.exec(body)[1].split('\n');
	assert.equal(fence.length, 7);
	assert.equal(fence.at(-1), '    …');
	assert.match(issueCopied(renderReportHtml(md([
		'## Findings', '', '| # | Finding | Severity |', '|---|---|---|', '| 1 | a claim | minor |',
		'', '### Finding 1: a claim', '', '**Observed:** nothing.',
	].join('\n'))), 1), /## Error messages\nNone recorded by the run\./);
});

test('issue: the likely cause folds as a hypothesis, and a local run links no report', () => {
	const html = renderReportHtml(FULL, { base: '/runs/r1' });
	const body = issueCopied(html, 1);
	assert.match(body, /<details><summary>[^<]*hypothesis[^<]*<\/summary>\n\nThe timeout was cut to 10 s\.\n\n<\/details>/);
	assert.match(body, /^<sub>Reported by exploratory test /);
	assert.doesNotMatch(body, /\/runs\/r1/);
	assert.match(body, /^Screenshots and logs are in the exploratory test report for this run\.$/m);
	assert.match(body, /\*\*Positron and OS:\*\* {2}\nNot recorded\n/);
});

test('issue: parseSystemLine reads the ledger line, and "not recorded" where it says so', () => {
	assert.deepEqual(parseSystemLine('- Positron 2026.10.0 build 12, dev build of ed2487a1a2 (Code - OSS 1.105.0), on Ubuntu 22.04 (Linux x64).'),
		{ positron: 'Positron 2026.10.0 build 12 (dev build of `ed2487a1a2`)', os: 'Ubuntu 22.04, Linux x64' });
	assert.deepEqual(parseSystemLine('Positron 2026.9.1 build 3, a release build of 0123abcd99 (Code - OSS 1.104.0), on macOS 15.1 (Darwin arm64)'),
		{ positron: 'Positron 2026.9.1 build 3 (release build of `0123abcd99`)', os: 'macOS 15.1, Darwin arm64' });
	assert.deepEqual(parseSystemLine('- Positron not recorded, on not recorded.'), { positron: 'Positron not recorded', os: 'OS not recorded' });
	assert.equal(parseSystemLine('- Positron (pre-launched, CDP 44987), workspace /tmp/x.'), null);
});

test('issue: a finding\'s Feature prefixes the issue title', () => {
	const md = LOGS_REPORT.replace(/^(### Finding 1: .*)$/m, '$1\n\n**Feature:** data explorer');
	const html = renderReportHtml(md, { ledger: LOGS_LEDGER, base: 'https://cdn.example/run1', readFile: logsRead });
	const card = unescapeHtml(/<article id="f1"[\s\S]*?<h2 class="card-title">([^<]*)<\/h2>/.exec(html)[1]);
	assert.equal(issueUrl(html, 1).searchParams.get('title'), `data explorer: ${card[0].toLowerCase()}${card.slice(1)}`);
	assert.equal(issueUrl(html, 2).searchParams.get('title').includes('data explorer'), false);
	assert.doesNotMatch(html, /Feature:<\/strong>|\*\*Feature:\*\*/);
});
test('issue: the claim after the Feature starts lowercase unless its first word is a name', () => {
	const title = (claim, extra = '') => {
		const md = LOGS_REPORT.replace(/^### Finding 1: .*$/m, `### Finding 1: ${claim}\n\n**Feature:** console${extra}`);
		const html = renderReportHtml(md, { ledger: LOGS_LEDGER, base: 'https://cdn.example/run1', readFile: logsRead });
		return issueUrl(html, 1).searchParams.get('title');
	};
	assert.equal(title('Typing while busy aborts'), 'console: typing while busy aborts');
	assert.equal(title('R aborts while busy'), 'console: R aborts while busy');
	assert.equal(title('PyPI lookups are skipped'), 'console: PyPI lookups are skipped');
	assert.equal(title('A preview goes blank'), 'console: a preview goes blank');
	// Named nowhere else, a capitalized word cannot be told from a sentence start.
	assert.equal(title('Quarto previews go blank'), 'console: quarto previews go blank');
	assert.equal(title('Quarto previews go blank', '\n\nOpening the Quarto preview shows nothing.'), 'console: Quarto previews go blank');
});

test('issue: a body too long for the link drops the file text, then falls back to copying', () => {
	const big = p => p.endsWith('slow.py') ? Buffer.from(`x = 1\n`.repeat(2000)) : logsRead(p);
	const dropped = logsIssueHtml({ readFile: big });
	const url = issueUrl(dropped, 1);
	assert.ok(url.href.length <= 8000);
	assert.match(url.searchParams.get('body'), /^`slow\.py` is in the report's `files\/` folder\.$/m);
	assert.doesNotMatch(url.searchParams.get('body'), /<summary>slow\.py/);
	assert.doesNotMatch(dropped, /data-issue=/);

	const huge = LOGS_REPORT.replace(/^\*\*Observed:\*\* /m, `**Observed:** ${'very long. '.repeat(900)}`);
	const html = renderReportHtml(huge, { ledger: LOGS_LEDGER, base: 'https://cdn.example/run1', readFile: logsRead });
	const anchor = issueAnchor(html, 1);
	const fallback = issueUrl(html, 1);
	assert.equal(fallback.searchParams.get('body'), null);
	assert.equal(fallback.searchParams.get('labels'), 'ai-discovered');
	assert.match(anchor, / data-issue="issue-f1"/);
	// The copy holds everything, file text included.
	assert.match(issueCopied(html, 1), /<summary>slow\.py<\/summary>/);

	// Run the page's handler against a stub DOM: a click copies the text and shows the toast.
	const src = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('gh-toast'));
	assert.ok(src);
	assert.ok(!logsIssueHtml().includes('gh-toast\''));
	const el = () => ({ classList: { add(c) { this.on = c; }, remove() { this.on = null; } }, setAttribute() {}, appendChild() {}, querySelector: () => ({}) });
	const toast = el();
	let handler, copied;
	const link = { dataset: { issue: 'issue-f1' }, addEventListener: (_, fn) => { handler = fn; } };
	const document = {
		createElement: () => toast, body: { appendChild() {} },
		querySelectorAll: () => [link],
		getElementById: id => id === 'issue-f1' ? { textContent: unescapeHtml(issueBlock(html, 1)) } : null,
	};
	const navigator = { clipboard: { writeText: t => { copied = t; return { then: ok => ok() }; } } };
	new Function('document', 'navigator', 'window', 'setTimeout', 'clearTimeout', src)(document, navigator, { isSecureContext: true }, () => 0, () => {});
	handler();
	assert.equal(copied, issueCopied(html, 1));
	assert.equal(toast.classList.on, 'show');
	assert.match(src, /Description copied\. Paste it into the issue on GitHub\./);
	assert.match(src, /,5000\)/);
});

test('issue: a body too long for the link drops sections least needed first, and keeps the repro', () => {
	const long = LOGS_REPORT.replace(/^\*\*Expected:\*\* /m, `**Cause:** ${'long hypothesis. '.repeat(400)}\n\n**Expected:** `);
	const html = renderReportHtml(long, { ledger: LOGS_LEDGER, base: 'https://cdn.example/run1', readFile: logsRead });
	const url = issueUrl(html, 1);
	const body = url.searchParams.get('body');
	assert.ok(url.href.length <= 8000);
	assert.doesNotMatch(issueAnchor(html, 1), /data-issue=/);
	// Dropped in order up to the cause: files, the regression test, the cause.
	assert.doesNotMatch(body, /Likely cause|Regression test|<summary>slow\.py/);
	assert.match(body, /^Screenshots and logs are in the \[exploratory test\]\(https:\/\/cdn\.example\/run1\/index\.html#f1\) report for this run\.$/m);
	// Not reached: the repro and the error output stay.
	assert.match(body, /## Steps to reproduce/);
	assert.match(body, /## Actual\nThe summary never loads/);
	assert.doesNotMatch(body, /## Error messages\n(?:In the|None recorded)/);
});

test('issue: a saved script cannot end the embedded block early', () => {
	const html = renderReportHtml(md([
		'## Findings', '', '| # | Finding | Severity |', '|---|---|---|', '| 1 | a claim | minor |',
		'', '### Finding 1: a claim', '', '**Observed:** the tag `</script>` and `<!--` ended the block.',
	].join('\n')));
	assert.doesNotMatch(issueBlock(html, 1), /<\/script|<!--/i);
	assert.match(issueCopied(html, 1), /`<\/script>` and `<!--`/);
	assert.match(issueUrl(html, 1).searchParams.get('body'), /`<\/script>` and `<!--`/);
});

test('issue: icons rest until their own button is hovered', () => {
	const html = renderReportHtml(FULL);
	assert.doesNotMatch(html, /\.card:hover \.cp-btn|\.card:hover \.gh-btn/);
	assert.match(html, /\.gh-btn\{[^}]*color:var\(--cp-rest\)/);
	assert.match(html, /\.gh-btn:hover\{color:var\(--ink\);background:var\(--cp-hover-bg\)\}/);
	assert.match(html, /\.gh-btn\+\.cp-btn\{margin-left:-19px\}/);
});

const FINDING_FORM = 'https://docs.google.com/forms/d/e/1FAIpQLSc98gL34VYnh7oZAJ1MVj0HRvFUV9YI4xc8nFvMtWiqrsxiiw/viewform';
const REPORT_FORM = 'https://docs.google.com/forms/d/e/1FAIpQLSegogwIITog5IQGT0uUBYKekKRXO2nHSiAU4T4otg7FQc20qw/viewform';

/** Each feedback link's pre-filled answers, by form question; a finding row goes to the finding form, the header button to the report form. */
function feedbackAnswers(html, cls) {
	const hrefs = cls === 'fb-top'
		? [...html.matchAll(/<a class="fb-top" href="([^"]+)"/g)].map(m => m[1])
		: [...html.matchAll(/<div class="fb" [^>]*>(.*?)<\/div>/g)].flatMap(m => [...m[1].matchAll(/href="([^"]+)"/g)].map(h => h[1]));
	return hrefs.map(href => {
		const url = new URL(href.replace(/&amp;/g, '&'));
		assert.equal(`${url.origin}${url.pathname}`, cls === 'fb-top' ? REPORT_FORM : FINDING_FORM);
		// The "Feedback on" question is gone from both forms.
		assert.equal(url.searchParams.has('entry.857252905'), false);
		return {
			report: url.searchParams.get('entry.1746253506'),
			version: url.searchParams.get('entry.1873070470'),
			finding: url.searchParams.get('entry.890833928'),
			verdict: url.searchParams.get('entry.427792690'),
		};
	});
}

test('feedback: a published page asks about each finding, and the verdicts match the form exactly', () => {
	const html = renderReportHtml(FULL, { base: 'https://cdn.example/run1/', skillVersion: '1.2' });
	const answers = feedbackAnswers(html, 'fb');
	const titles = parseReport(FULL).findings.map(f => f.title);
	assert.equal(titles[0], 'a longer claim');
	// In the form's order, which is also the buttons'.
	const verdicts = ['Real issue', 'Not a bug', 'Enhancement idea', 'Real, but not worth reporting', 'Couldn\'t tell from the report'];
	assert.deepEqual(answers, [1, 2].flatMap(n => verdicts.map(verdict =>
		({ report: `https://cdn.example/run1/index.html#f${n}`, version: 'v1.2', finding: `Finding ${n} \u00B7 ${titles[n - 1]}`, verdict }))));
	assert.equal((html.match(/<div class="fb" /g) ?? []).length, 2);
	assert.match(html, /<span class="fb-q">Is this finding right\?<\/span>/);
	assert.match(html, />Couldn&rsquo;t tell<\/a>/);
	assert.match(html, />Enhancement<\/a>/);
	// The row closes its card: after Suggested tests, before the card ends.
	assert.match(html, /<div class="fb" role="group" [^>]*aria-label="Posit team feedback on finding 1">.*<\/div>\n<script type="text\/plain" id="prompt-f1">/);
});

test('feedback: a published page has one header button for the whole report, beside the theme switch', () => {
	const html = renderReportHtml(FULL, { base: 'https://cdn.example/run1', skillVersion: '1.2' });
	assert.deepEqual(feedbackAnswers(html, 'fb-top'),
		[{ report: 'https://cdn.example/run1/index.html', version: 'v1.2', finding: null, verdict: null }]);
	assert.match(html, /<header class="head">\n<a class="fb-top" [^>]*>.*Give feedback<\/span><\/a>\n<nav class="switch"/);
});

test('feedback: a local page, which only has a path, asks for none', () => {
	for (const base of [undefined, '/Users/someone/run1', 'run1']) {
		const html = renderReportHtml(FULL, { base, skillVersion: '1.2' });
		assert.doesNotMatch(html, /docs\.google\.com|class="fb[ "]|class="fb-top"/, `base: ${base}`);
	}
});

/** Runs the page's feedback script against a stub window; returns a click dispatcher and the window.open calls. */
function feedbackPopup(html, { blocked = false } = {}) {
	const src = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('exploratory-feedback'));
	assert.ok(src);
	const opens = [];
	let handler;
	const popup = { closed: false, location: { href: '' }, focused: 0, focus() { this.focused++; } };
	const window = {
		screenX: 100, screenY: 50, outerWidth: 1400, outerHeight: 1000,
		open: (url, name, features) => { opens.push({ url, name, features }); return blocked || name === '_blank' ? null : popup; },
	};
	const document = { querySelectorAll: () => [], addEventListener: (type, fn) => { assert.equal(type, 'click'); handler = fn; } };
	new Function('document', 'window', 'screen', 'localStorage', 'setTimeout', src)(document, window, { availWidth: 1440, availHeight: 900 }, null, () => {});
	const click = (href, mods = {}) => {
		const a = { href, dataset: {} };
		const e = { button: 0, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, target: { closest: sel => sel === '.fb a, a.fb-top' ? a : null }, ...mods };
		handler(e);
		return e.defaultPrevented;
	};
	return { click, opens, popup };
}

test('feedback: a plain click opens the form in one reused pop-up over the report', () => {
	const html = renderReportHtml(FULL, { base: 'https://cdn.example/run1', skillVersion: '1.2' });
	// The links still work with script off.
	assert.ok([...html.matchAll(/<a (?:class="fb-top" )?href="https:\/\/docs\.google\.com[^>]*>/g)].every(m => / target="_blank" rel="noopener"/.test(m[0])));
	const { click, opens, popup } = feedbackPopup(html);
	assert.equal(click('https://forms.example/finding'), true);
	// 680 x 820, which fits the 1440 x 900 screen; centred across, a third of the way down.
	assert.deepEqual(opens, [{ url: '', name: 'exploratory-feedback', features: 'popup,width=680,height=820,left=460,top=110' }]);
	assert.doesNotMatch(opens[0].features, /noopener/);
	assert.equal(popup.location.href, 'https://forms.example/finding');
	assert.equal(click('https://forms.example/report'), true);
	assert.equal(opens.length, 1);
	assert.equal(popup.location.href, 'https://forms.example/report');
	assert.equal(popup.focused, 2);
	// Once it is closed, the next click opens a new one.
	popup.closed = true;
	click('https://forms.example/finding');
	assert.equal(opens.length, 2);
});

test('feedback: a modified or middle click keeps the link\'s own behaviour, and a blocked pop-up falls back to a tab', () => {
	const html = renderReportHtml(FULL, { base: 'https://cdn.example/run1', skillVersion: '1.2' });
	const { click, opens } = feedbackPopup(html);
	for (const mods of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
		assert.equal(click('https://forms.example/finding', mods), false, JSON.stringify(mods));
	}
	assert.equal(opens.length, 0);
	const blocked = feedbackPopup(html, { blocked: true });
	assert.equal(blocked.click('https://forms.example/finding'), true);
	assert.deepEqual(blocked.opens.map(o => [o.url, o.name, o.features]).at(-1), ['https://forms.example/finding', '_blank', 'noopener']);
	// A local page has no feedback links, so no script for them.
	assert.doesNotMatch(renderReportHtml(FULL, { skillVersion: '1.2' }), /exploratory-feedback/);
});

test('feedback: each verdict also carries its one-click submit address, with the same answers', () => {
	const html = renderReportHtml(FULL, { base: 'https://cdn.example/run1', skillVersion: '1.2' });
	const rows = [...html.matchAll(/<div class="fb" ([^>]*)>(.*?)<\/div>/g)];
	assert.equal(rows.length, 2);
	assert.match(rows[1][1], /^role="group" aria-live="polite" data-report="https:\/\/cdn\.example\/run1\/index\.html" data-finding="f2" /);
	for (const [, , inner] of rows) {
		const links = [...inner.matchAll(/<a href="([^"]+)" data-submit="([^"]+)" data-verdict="([^"]+)"/g)];
		assert.equal(links.length, 5);
		for (const [, href, submit, verdict] of links) {
			const form = new URL(href.replace(/&amp;/g, '&'));
			const one = new URL(submit.replace(/&amp;/g, '&'));
			// The address that worked when tried by hand: no usp, and a Submit.
			assert.equal(`${one.origin}${one.pathname}`, FINDING_FORM.replace(/viewform$/, 'formResponse'));
			assert.equal(one.searchParams.get('submit'), 'Submit');
			assert.equal(one.searchParams.has('usp'), false);
			assert.equal(one.searchParams.get('entry.427792690'), verdict.replace(/&#39;/g, '\''));
			for (const entry of ['entry.1746253506', 'entry.1873070470', 'entry.890833928', 'entry.427792690']) {
				assert.equal(one.searchParams.get(entry), form.searchParams.get(entry), entry);
			}
		}
	}
});

/** A fake DOM, just enough for the feedback script: a page of rows built from the rendered HTML. */
function feedbackDom(html, storage) {
	const matches = (el, sel) => sel.split(', ').some(one => {
		if (one === '.fb a') {
			return el.tag === 'a' && !!el.parent?.closest('.fb');
		}
		const [, tag, cls, data] = /^(a|button|span|div)?(?:\.([\w-]+))?(?:\[data-([\w-]+)\])?$/.exec(one) ?? [];
		return (!tag || el.tag === tag) && (!cls || el.classList.includes(cls)) && (!data || data in el.dataset);
	});
	class El {
		constructor(tag, parent) { this.tag = tag; this.parent = parent; this.children = []; this.dataset = {}; this.attrs = {}; this.className = ''; this.textContent = ''; this.hidden = false; }
		get classList() { return this.className.split(/\s+/); }
		// Only the empty span the answer pill's label goes in becomes an element.
		set innerHTML(v) { this.html = v; if (v.includes('<span></span>')) { this.appendChild(new El('span', this)); } }
		setAttribute(k, v) { this.attrs[k] = v; if (k.startsWith('data-')) { this.dataset[k.slice(5)] = v; } }
		appendChild(c) { c.parent = this; this.children.push(c); return c; }
		remove() { this.parent.children = this.parent.children.filter(c => c !== this); }
		focus() { page.focused = this; }
		all() { return this.children.flatMap(c => [c, ...c.all()]); }
		querySelectorAll(sel) { return this.all().filter(e => matches(e, sel)); }
		querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
		closest(sel) { for (let e = this; e && e.tag; e = e.parent) { if (matches(e, sel)) { return e; } } return null; }
		get text() { return this.textContent + this.children.map(c => c.text).join(''); }
		get label() { return this.children.filter(c => !c.hidden).map(c => c.text).join('|'); }
	}
	const page = new El('body', null);
	for (const [, attrs, inner] of html.matchAll(/<div class="fb" ([^>]*)>(.*?)<\/div>/g)) {
		const row = page.appendChild(new El('div', page));
		row.className = 'fb';
		for (const [, k, v] of attrs.matchAll(/(data-[\w-]+)="([^"]*)"/g)) { row.setAttribute(k, v); }
		const q = row.appendChild(new El('span', row)); q.className = 'fb-q'; q.textContent = 'Is this finding right?';
		for (const [, href, submit, verdict, label] of inner.matchAll(/<a href="([^"]+)" data-submit="([^"]+)" data-verdict="([^"]+)"[^>]*>([^<]+)<\/a>/g)) {
			const a = row.appendChild(new El('a', row));
			a.href = href.replace(/&amp;/g, '&');
			a.setAttribute('data-submit', submit.replace(/&amp;/g, '&'));
			a.setAttribute('data-verdict', verdict.replace(/&#39;/g, '\''));
			a.textContent = label.replace('&rsquo;', '’');
		}
	}
	const src = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('exploratory-feedback'));
	const opens = [];
	let handler;
	const popup = { closed: false, location: {}, focus() {} };
	Object.defineProperty(popup.location, 'href', { set(v) { opens.push(v); } });
	const body = new El('body', null);
	const timers = [];
	const document = {
		body,
		querySelectorAll: sel => page.querySelectorAll(sel),
		createElement: tag => new El(tag, null),
		createTextNode: text => Object.assign(new El('#text', null), { textContent: text }),
		addEventListener: (_, fn) => { handler = fn; },
	};
	new Function('document', 'window', 'screen', 'localStorage', 'setTimeout', src)(document, { open: () => popup }, {}, storage, fn => timers.push(fn));
	const rows = page.children;
	// The hidden frames a verdict click loads, which record it with no window.
	const sends = () => body.children.map(f => f.src);
	const click = (el, mods = {}) => {
		const e = { button: 0, target: el, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...mods };
		handler(e);
		return e.defaultPrevented;
	};
	const verdict = (row, name) => row.children.find(c => c.dataset.verdict === name);
	return { page, rows, click, opens, sends, body, timers, verdict };
}

function memoryStorage() {
	const map = new Map();
	return { map, getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k) };
}

test('feedback: a verdict click records it in one click and shows the answer, remembered on reload', () => {
	const html = renderReportHtml(FULL, { base: 'https://cdn.example/run1', skillVersion: '1.2' });
	const storage = memoryStorage();
	const { rows, click, opens, sends, body, timers, verdict, page } = feedbackDom(html, storage);
	const pick = verdict(rows[1], 'Not a bug');
	assert.equal(click(pick), true);
	// No window: the verdict goes in a hidden frame, which is removed later.
	assert.deepEqual(opens, []);
	assert.deepEqual(sends(), [pick.dataset.submit]);
	const [frame] = body.children;
	assert.equal(frame.tag, 'iframe');
	assert.equal(frame.hidden, true);
	timers.forEach(fn => fn());
	assert.deepEqual(sends(), []);
	assert.equal(rows[1].label, 'Is this finding right?|Not a bug|Add a note');
	const pill = rows[1].querySelector('.fb-done');
	assert.equal(pill.tag, 'button');
	assert.equal(pill.attrs['aria-label'], 'Your answer: Not a bug. Change answer');
	assert.equal(pill.dataset.tip, 'Change answer');
	assert.match(pill.html, /class="fb-car"/);
	assert.equal(rows[0].label.split('|').length, 6, 'the other finding is untouched');
	assert.deepEqual([...storage.map].filter(([k]) => k !== 'fb:id'), [['fb:https://cdn.example/run1/index.html#f2', 'Not a bug']]);
	const note = rows[1].querySelector('.fb-note');
	assert.equal(page.focused, note);
	// Add a note opens the pre-filled form, and records nothing more.
	assert.equal(note.href, pick.href);
	click(note);
	assert.deepEqual(opens, [pick.href]);

	// A reload shows the answer again, without submitting.
	const again = feedbackDom(html, storage);
	assert.equal(again.rows[1].label, 'Is this finding right?|Not a bug|Add a note');
	assert.deepEqual(again.opens, []);

	assert.deepEqual(again.sends(), []);

	// Clicking the answer forgets it and brings the buttons back, sending nothing.
	again.click(again.rows[1].querySelector('.fb-done'));
	assert.equal(again.rows[1].label, 'Is this finding right?|Real issue|Not a bug|Enhancement|Not worth reporting|Couldn’t tell');
	assert.deepEqual([...storage.map.keys()], ['fb:id']);
	assert.equal(again.page.focused, again.verdict(again.rows[1], 'Real issue'));
	assert.deepEqual(again.sends(), []);
	// Picking again sends the new verdict.
	const other = again.verdict(again.rows[1], 'Real issue');
	again.click(other);
	assert.deepEqual(again.sends(), [other.dataset.submit]);
});

test('feedback: a modified click opens the form without recording, and blocked storage only loses the memory', () => {
	const html = renderReportHtml(FULL, { base: 'https://cdn.example/run1', skillVersion: '1.2' });
	const storage = memoryStorage();
	const { rows, click, opens, sends, verdict } = feedbackDom(html, storage);
	assert.equal(click(verdict(rows[0], 'Real issue'), { metaKey: true }), false);
	assert.deepEqual(opens, []);
	assert.deepEqual(sends(), []);
	assert.deepEqual([...storage.map.keys()], ['fb:id']);
	assert.equal(rows[0].label.split('|').length, 6);

	const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
	const blocked = feedbackDom(html, throwing);
	blocked.click(blocked.verdict(blocked.rows[0], 'Real issue'));
	assert.equal(blocked.sends().length, 1);
	assert.equal(blocked.rows[0].label, 'Is this finding right?|Real issue|Add a note');

	// A stored value that is not one of the page's verdicts is dropped, never shown.
	const planted = memoryStorage();
	planted.setItem('fb:https://cdn.example/run1/index.html#f1', '<img src=x onerror=alert(1)>');
	const p = feedbackDom(html, planted);
	assert.equal(p.rows[0].label.split('|').length, 6);
	assert.deepEqual([...planted.map.keys()], ['fb:id']);
});

test('feedback: every finding answer from a browser carries the same random ID, kept across reloads', () => {
	const html = renderReportHtml(FULL, { base: 'https://cdn.example/run1', skillVersion: '1.2' });
	const ids = links => links.flatMap(a => [a.href, a.dataset.submit]).map(u => new URL(u).searchParams.getAll('entry.1280428395'));
	const storage = memoryStorage();
	const first = feedbackDom(html, storage);
	const links = first.rows.flatMap(r => r.querySelectorAll('a[data-verdict]'));
	const [[id]] = ids(links);
	assert.match(id, /^[0-9a-f]{12}$/);
	assert.ok(ids(links).every(v => v.length === 1 && v[0] === id), 'once per link, the same everywhere');
	assert.equal(storage.getItem('fb:id'), id);
	const again = feedbackDom(html, storage);
	assert.ok(ids(again.rows.flatMap(r => r.querySelectorAll('a[data-verdict]'))).every(v => v[0] === id));
	// A different browser gets its own; one that cannot store gets one per page.
	assert.notEqual(ids(feedbackDom(html, memoryStorage()).rows[0].querySelectorAll('a[data-verdict]'))[0][0], id);
	// A stored value that is not an ID is replaced.
	const planted = memoryStorage();
	planted.setItem('fb:id', '&entry.427792690=Not%20a%20bug');
	const p = feedbackDom(html, planted);
	assert.match(planted.getItem('fb:id'), /^[0-9a-f]{12}$/);
	assert.ok(ids(p.rows[0].querySelectorAll('a[data-verdict]')).every(v => v[0] === planted.getItem('fb:id')));
});

test('feedback: a missing skill version is sent as unknown, never blank', () => {
	const html = renderReportHtml(FULL, { base: 'https://cdn.example/run1' });
	assert.ok(feedbackAnswers(html, 'fb-top').every(a => a.version === 'unknown'));
});

test('skillVersion reads SKILL.md\'s frontmatter, never its body, with no v', () => {
	assert.match(skillVersion(), /^\d+\.\d+/);
	assert.equal(skillVersion('---\nname: x\nmetadata:\n  version: "2.3"\n---\n'), '2.3');
	assert.equal(skillVersion('---\nname: x\nmetadata:\n  version: v2.3\n---\n'), '2.3');
	assert.equal(skillVersion('---\nname: x\n---\n\nversion: 9.9\n'), null);
});

test('the footer names the version the feedback links send, with a v, published or not', () => {
	for (const base of ['https://cdn.example/run1', '/tmp/run1']) {
		const html = renderReportHtml(FULL, { base, skillVersion: '1.2' });
		assert.match(html, /<a class="sig-link" [^>]*>exploratory-test <span class="sig-ver">v1\.2<\/span> &#8599;<\/a>/);
	}
	const published = renderReportHtml(FULL, { base: 'https://cdn.example/run1', skillVersion: '1.2' });
	assert.ok(feedbackAnswers(published, 'fb').every(a => a.version === 'v1.2'));
	// No version: the name alone, with no empty span and no placeholder.
	assert.match(renderReportHtml(FULL), /<a class="sig-link" [^>]*>exploratory-test &#8599;<\/a>/);
	assert.doesNotMatch(renderReportHtml(FULL), /sig-ver/);
});

test('code copy: inline code in Reproduce copies on click, and nothing else on the card does', () => {
	const html = renderReportHtml(md([
		'## Findings', '', '| # | Finding | Severity |', '|---|---|---|', '| 1 | a claim | minor |',
		'', '### Finding 1: a claim', '',
		'**Repro** -- starting state: a Python console.', '',
		'**Preconditions:** `slow.py` loaded with `%run -i slow.py`.', '',
		'1. Run `%view df`.', '',
		'   ```python', '   df.head()', '   ```', '',
		'2. Verify the grid shows `df`. -> FAIL (finding 1)', '',
		'**Observed:** the grid showed `None`.',
	].join('\n')));
	const chips = [...html.matchAll(/<code class="cc" data-tip="Copy">([^<]*)<\/code>/g)].map(m => m[1]);
	assert.deepEqual(chips, ['slow.py', '%run -i slow.py', '%view df', 'df']);
	// A code block keeps its own Copy button; Observed is prose, not a command.
	assert.match(html, /<pre><code class="language-python">df\.head\(\)<\/code><\/pre>/);
	assert.match(html, /<div class="oe-label">Observed<\/div><p>the grid showed <code>None<\/code>/);
	assert.match(html, /code\.cc'\)\.forEach/);
});

test('code copy: a page with no inline code in Reproduce ships no script for it', () => {
	assert.doesNotMatch(renderReportHtml(md('Nothing to reproduce.')), /code\.cc'\)\.forEach/);
});

// Known issues: issues the PR fixes and issues that mention it, fetched before the run.
const KI_REPORT = `# Exploratory test: x

\`b\` | \`abc1234\`

**Result:** It works.
**Tested:** the panel
**Not exercised:** the web build

## Findings

| # | Finding | Severity | Impact | Reproduction | Verified | Known |
|---|---------|----------|--------|--------------|----------|-------|
| 1 | Still jumps | major | loses place | 3/3 | confirmed | #11, #15102 |
| 2 | Old bug back | minor | looks wrong | 2/2 | disputed | #21 |
| 3 | Looks known | moderate | slow | 2/2 | unresolved | #25, #20 |

### Finding 1: Still jumps

**Observed:** it jumps.

**Expected:** it stays.

### Finding 2: Old bug back

**Observed:** it is back.

**Expected:** it is gone.

### Finding 3: Looks known

**Observed:** it is slow.

**Expected:** it is fast.

<details>
<summary>Verification details</summary>

A second agent.

VERDICTS: 1=CONFIRMED; 2=FALSE POSITIVE; 3=UNRESOLVED
KNOWN: 1=#11,#15102; 2=#21; 3=#25,#20
LINKED: #23=major; #20=minor; #26=minor

**1.** Checks out.

</details>
`;
const KI_LEDGER = `## S01 - fix one
Status: pass
Result: loads
Issue: #10 fix held
Issue: #26 observed

## S02 - fix two
Status: fail - Finding 1
Result: jumps
Issue: #11 fix did not hold

## S03 - old bug
Status: fail - Finding 2
Result: back
Issue: #21 came back

## S04 - slow
Status: fail - Finding 3
Result: slow
Issue: #25 observed

## S05 - other
Status: pass
Result: fine
Issue: #22 observed
Issue: #23 observed
Issue: #26 observed

## Not run
- N01 - web - Fix for #12 not exercised: desktop only
- N02 - scroll - Already filed as #24
`;
const KI_ISSUES = {
	pr: 100,
	issues: [
		{ number: 10, relation: 'fixes', state: 'open', title: 'held', createdAt: '2026-08-20T00:00:00Z', summary: '' },
		{ number: 11, relation: 'fixes', state: 'open', title: 'failed', createdAt: '2026-08-20T00:00:00Z', summary: 'x' },
		{ number: 12, relation: 'fixes', state: 'open', title: 'skipped', createdAt: '2026-08-20T00:00:00Z', summary: '' },
		{ number: 13, relation: 'fixes', state: 'open', title: 'unaccounted <b>"&', createdAt: '2026-08-20T00:00:00Z', summary: '' },
		{ number: 20, relation: 'linked', state: 'open', title: 'also similar', createdAt: '2026-08-20T00:00:00Z', summary: '' },
		{ number: 21, relation: 'linked', state: 'closed', title: 'regressed', createdAt: '2026-08-20T00:00:00Z', summary: '' },
		{ number: 22, relation: 'linked', state: 'open', title: 'Title "<script>&', createdAt: '2026-08-20T00:00:00Z', summary: 'a "<b>" & c' },
		{ number: 23, relation: 'linked', state: 'open', title: 'major one', createdAt: '2026-08-20T00:00:00Z', summary: '' },
		{ number: 24, relation: 'linked', state: 'open', title: 'not seen', createdAt: '2026-08-20T00:00:00Z', summary: '' },
		{ number: 25, relation: 'linked', state: 'open', title: 'similar', createdAt: '2026-08-20T00:00:00Z', summary: '' },
		{ number: 26, relation: 'linked', state: 'open', title: 'minor one', createdAt: '2026-08-20T00:00:00Z', summary: '' },
	],
};
const kiHtml = (options = {}) => renderReportHtml(KI_REPORT, { ledger: KI_LEDGER, knownIssues: KI_ISSUES, startedAt: new Date('2026-09-29T00:00:00Z'), ...options });
const findingsOf = html => html.slice(html.indexOf('id="findings"'), html.indexOf('</section>', html.indexOf('id="findings"')));
const kiRows = html => [...findingsOf(html).matchAll(/<div class="row findings-grid ki-row">([\s\S]*?)<\/div>/g)].map(m => m[1]);
const findingRow = (html, n) => new RegExp(`<a href="#f${n}" class="row findings-grid">[\\s\\S]*?</a>(?=\\n)`).exec(findingsOf(html))[0];
const linkedOf = html => /<details class="ki-grp">[\s\S]*?<\/details>/.exec(findingsOf(html))?.[0] ?? '';
const kiList = (html, id) => new RegExp(`<div class="ki-list" id="${id}" hidden>([\\s\\S]*?)</div></div>(?=<div class="ki-list"|\\n)`).exec(findingsOf(html))?.[1] ?? '';
const kiCnt = (id, text) => `<span class="ki-cnt" role="button" tabindex="0" aria-haspopup="dialog" aria-expanded="false" aria-controls="${id}">${text}</span>`;

test('Linked issues is one closed row under the findings, counting what is inside', () => {
	const html = kiHtml();
	const f = findingsOf(html);
	const linked = linkedOf(html);
	assert.ok(f.indexOf('<a href="#f3"') < f.indexOf('<details class="ki-grp">'), 'under the findings');
	assert.doesNotMatch(linked, /<details class="ki-grp" open/);
	const dot = '<span class="ki-dot" aria-hidden="true">&middot;</span>';
	assert.ok(linked.startsWith(`<details class="ki-grp"><summary><span class="ki-lbl"><b>Linked issues</b></span><span class="ki-sum">3 observed${dot}${kiCnt('ki-list-fix', '1 fix verified')}${dot}${kiCnt('ki-list-no', '1 not observed')}</span><svg class="ki-chev"`), linked.slice(0, 400));
	assert.doesNotMatch(f, /ki-group|ki-foot|ki-line|Already filed/);
	assert.ok(f.indexOf('</details>') < f.indexOf('id="ki-list-fix"'), 'lists sit outside the row');
	assert.ok(html.includes("closest('.ki-cnt')"), 'list script');
});

test('Linked issues lists open observed issues by severity, unrated last, then the fixes verified and the rest', () => {
	const html = kiHtml();
	assert.deepEqual(kiRows(html).map(r => />#(\d+)<\/a>/.exec(r)[1]), ['23', '26', '22']);
	const [, twice, unrated] = kiRows(html);
	assert.match(twice, /Observed in 2 scenarios &middot; <a class="ki-ev" href="#cv-row-\d+">View evidence<\/a>/);
	assert.match(twice, /<span class="rate">2<\/span>/);
	assert.match(twice, /<span class="ki-st"><span>Open &middot; <a class="ki-num"/);
	assert.ok(unrated.startsWith('<span></span>'), 'no pill when the verifier gave no severity');
	assert.doesNotMatch(unrated, /Unrated|&mdash;/);
});

test('the fix verified and not observed lists name each issue with its state and where it stood', () => {
	const html = kiHtml();
	const it = (n, title, meta) => `<div class="ki-lc-it"><a class="ki-lc-n" href="https://github.com/posit-dev/positron/issues/${n}" target="_blank" rel="noopener">#${n}</a><span>${title}<span class="ki-lc-m">${meta}</span></span>`;
	assert.equal(kiList(html, 'ki-list-fix'), `<div class="ki-lc-h">Fix verified this run</div>${it(10, 'held', 'Open &middot; passed in &ldquo;fix one&rdquo;')}`);
	// A closed issue that came back and an issue a finding matched are findings, so neither is listed.
	assert.equal(kiList(html, 'ki-list-no'), `<div class="ki-lc-h">Linked to this PR, not observed</div>${it(24, 'not seen', 'Open &middot; skipped on purpose, see Coverage')}`);
	const unseen = kiHtml({ ledger: KI_LEDGER.replace(/^Issue: #22 observed\n/m, '') });
	assert.match(kiList(unseen, 'ki-list-no'), /#22<\/a><span>Title &quot;&lt;script&gt;&amp;<span class="ki-lc-m">Open &middot; no scenario reached it<\/span>/);
});

test('Linked issues leaves out zero counts, opens only onto observed issues, and is left out with no counts', () => {
	const noFix = kiHtml({ ledger: KI_LEDGER.replace('Issue: #10 fix held\n', '') });
	assert.match(linkedOf(noFix), /<span class="ki-sum">3 observed<span class="ki-dot" aria-hidden="true">&middot;<\/span><span class="ki-cnt"[^>]*>1 not observed<\/span><\/span>/);
	assert.doesNotMatch(findingsOf(noFix), /ki-list-fix/);
	// Nothing observed: the same row with its counts, but nothing to open.
	const f = findingsOf(kiHtml({ ledger: KI_LEDGER.replace(/^Issue: #2[236] observed\n/gm, '') }));
	assert.doesNotMatch(f, /<details class="ki-grp"|ki-chev/);
	assert.match(f, new RegExp(`<div class="ki-grp"><div class="ki-hd"><span class="ki-lbl"><b>Linked issues</b></span><span class="ki-sum">${kiCnt('ki-list-fix', '1 fix verified')}<span class="ki-dot" aria-hidden="true">&middot;</span>${kiCnt('ki-list-no', '4 not observed')}</span></div></div>`));
	const onlyFixes = { pr: 100, issues: KI_ISSUES.issues.filter(i => [11, 12].includes(i.number)) };
	assert.equal(linkedOf(kiHtml({ knownIssues: onlyFixes })), '', 'a failed fix is a finding and an unexercised one is in Coverage');
});

test('known issues are not findings: no number, no card, not counted', () => {
	const html = kiHtml();
	for (const row of kiRows(html)) {
		assert.doesNotMatch(row, /class="n"|href="#f/);
	}
	assert.equal((findingsOf(html).match(/<a href="#f\d+" class="row/g) ?? []).length, 3);
});

test('a fix that did not hold and a closed issue that came back are findings with a red x and plain numbers', () => {
	const html = kiHtml();
	const one = findingRow(html, 1);
	assert.match(one, /<span class="ki-st"><span class="ki-reg"><span class="ki-x"><svg[^>]*>[\s\S]*?<\/svg><\/span>Fix didn&rsquo;t hold<\/span><span class="ki-state">Fixes <span class="ki-num-t"[^>]*>#11<\/span><\/span><\/span>/);
	assert.doesNotMatch(one.slice(1), /<a /, 'no link inside the row link');
	assert.doesNotMatch(one, /Possibly known/, 'the card carries it');
	const back = findingRow(renderReportHtml(KI_REPORT.replace('| disputed |', '| confirmed |'), { ledger: KI_LEDGER, knownIssues: KI_ISSUES }), 2);
	assert.match(back, /<span class="ki-reg"><span class="ki-x">[\s\S]*?<\/span>Regressed<\/span><span class="ki-state">Closed &middot; <span class="ki-num-t"[^>]*>#21<\/span><\/span>/);
});

test('an issue number in a row previews on hover but is not a link, so the row click stands', () => {
	const html = kiHtml();
	assert.match(findingRow(html, 1), /<span class="ki-num-t" data-state="open" data-opened="Opened Aug 20" data-title="failed" data-summary="x">#11<\/span>/);
	assert.ok(html.includes(".ki-num-t[data-title]"), 'the preview script picks it up');
	assert.match(findingRow(kiHtml({ knownIssues: { ...KI_ISSUES, issues: [] } }), 1), /<a href="#f1" class="row findings-grid">/);
});

test('a verdict other than Confirmed takes the label\'s place, with the issue line kept under it', () => {
	const two = findingRow(kiHtml(), 2);
	assert.match(two, /<span class="ki-st"><span class="status muted">Disputed<\/span><span class="ki-state">Closed &middot; <span class="ki-num-t"[^>]*>#21<\/span><\/span><\/span>/);
	assert.doesNotMatch(two, /Regressed|ki-x/);
});

test('a finding that matches an open linked issue says Similar to under its verdict, with a count past the first', () => {
	const three = findingRow(kiHtml(), 3);
	assert.match(three, /<span class="ki-st"><span class="status muted">Unresolved<\/span><span class="ki-state">Similar to <span class="ki-num-t"[^>]*>#25<\/span> \+1<\/span><\/span>/);
	const one = findingRow(kiHtml({ knownIssues: { ...KI_ISSUES, issues: KI_ISSUES.issues.filter(i => i.number !== 20) } }), 3);
	assert.match(one, /Similar to <span class="ki-num-t"[^>]*>#25<\/span><\/span>/);
	assert.doesNotMatch(findingRow(kiHtml(), 1), /Similar to/, 'a match on a fix or an unlisted issue changes no Status');
	// A finding's own issue wins, so the cell stays two lines and the match stays on the card.
	const mixed = renderReportHtml(KI_REPORT.replace('| #11, #15102 |', '| #11, #25 |').replace('KNOWN: 1=#11,#15102', 'KNOWN: 1=#11,#25'), { ledger: KI_LEDGER, knownIssues: KI_ISSUES });
	assert.equal((findingRow(mixed, 1).match(/ki-state/g) ?? []).length, 1);
	assert.doesNotMatch(findingRow(mixed, 1), /Similar to/);
	assert.match(card(mixed, 1), /Possibly known: <a class="ki-num"[^>]*>#25<\/a>/);
});

test('the card\'s Possibly known line sits under the title and drops the finding\'s own issue', () => {
	const html = kiHtml();
	const known = n => /<p class="ki-known">[\s\S]*?<\/p>/.exec(card(html, n))?.[0] ?? '';
	assert.ok(card(html, 1).indexOf('card-title') < card(html, 1).indexOf('ki-known'), 'under the title');
	assert.match(known(1), /<span class="ki-i"><svg[^>]*>[\s\S]*?<\/svg><\/span><span>Possibly known: <a class="ki-num" href="[^"]+\/issues\/15102" target="_blank" rel="noopener">#15102<\/a><\/span><\/p>$/);
	assert.doesNotMatch(known(1), /#11/, 'its own fix');
	assert.equal(known(2), '', 'its own regression');
	assert.match(known(3), /#25<\/a>, <a class="ki-num"[^>]*data-title="also similar"[^>]*>#20<\/a><\/span><\/p>/);
});

test('Coverage leads each row\'s result with its fixes and linked issues, after any finding link, and adds a Not run row for an unrecorded fix', () => {
	const c = coverageOf(kiHtml()).replace(/<a class="ki-num"[^>]*>/g, '<a>');
	assert.match(c, /Finding 1<\/a> &middot; Fix didn&rsquo;t hold for <a>#11<\/a> &middot; Jumps/);
	assert.match(c, /Finding 2<\/a> &middot; Regressed <a>#21<\/a> &middot; Back/);
	assert.match(c, /"cov-result">Fix verified for <a>#10<\/a> &middot; Also observed <a>#26<\/a> &middot; Loads/);
	assert.match(c, /"cov-result">Also observed <a>#22<\/a>, <a>#23<\/a>, <a>#26<\/a> &middot; Fine/);
	assert.match(c, /Not run<\/span> &middot; Fix for <a>#12<\/a> not exercised: desktop only/);
	assert.match(c, /Not run<\/span> &middot; Already filed as <a>#24<\/a>/);
	assert.match(c, /Not run<\/span> &middot; Fix for <a>#13<\/a> not exercised: the run did not record it/);
	assert.match(c, /Not run <span class="cf-cnt">3<\/span>/, 'the synthesized row is counted');
});

test('issue text from GitHub is escaped in rows and data attributes, and the preview script ships only with them', () => {
	const html = kiHtml();
	assert.match(html, /<span class="ki-title">Title &quot;&lt;script&gt;&amp;<\/span>/);
	assert.match(html, /data-title="Title &quot;&lt;script&gt;&amp;" data-summary="a &quot;&lt;b&gt;&quot; &amp; c"/);
	assert.doesNotMatch(html, /Title "<script>/);
	assert.ok(html.includes('a.ki-num[data-title]'), 'preview script');
	assert.ok(!renderReportHtml(KI_REPORT, { ledger: KI_LEDGER }).includes('a.ki-num[data-title]'), 'no script without issues');
});

test('the issue body names the fix that did not hold, or the issue that regressed, and the PR', () => {
	const html = kiHtml({ base: 'https://cdn.example/run1' });
	const body = n => issueUrl(html, n).searchParams.get('body');
	assert.ok(body(1).startsWith('The fix for #11 in #100 didn\'t hold.\n\n'), body(1).slice(0, 80));
	assert.ok(body(2).startsWith('#21 regressed in #100.\n\n'), body(2).slice(0, 80));
});

const NO_FINDINGS = KI_REPORT.replace(/## Findings[\s\S]*?(?=<details>)/, 'No findings.\n\n').replace(/VERDICTS: .*\nKNOWN: .*/, 'VERDICTS: none').replace('**1.** Checks out.', '');
const passing = ledger => ledger.replace(/Status: fail - Finding \d/g, 'Status: pass').replace('Issue: #11 fix did not hold', 'Issue: #11 fix held').replace(/^Issue: #2[15] .*\n/gm, '');

test('with no findings, the empty state and an open Linked issues row show without a header, when some were observed', () => {
	const f = findingsOf(renderReportHtml(NO_FINDINGS, { ledger: passing(KI_LEDGER), knownIssues: KI_ISSUES }));
	assert.doesNotMatch(f, /row-head/);
	const dot = '<span class="ki-dot" aria-hidden="true">&middot;</span>';
	assert.ok(f.includes(`<b>No new findings</b><span class="ki-empty-sum"><b>5</b> passed${dot}<b>3</b> not run</span></span><a class="ki-ev ki-empty-go" href="#coverage">See Coverage</a></div>`), f.slice(0, 600));
	assert.ok(f.indexOf('ki-empty') < f.indexOf('ki-grp'));
	assert.match(f, /<details class="ki-grp" open><summary>/);
	assert.match(f, /<span class="ki-sum">3 observed<span class="ki-dot" aria-hidden="true">&middot;<\/span><span class="ki-cnt"[^>]*>2 fix verified<\/span>/);
});

test('with no findings and nothing observed, the linked counts join the empty state and there is no Linked issues row', () => {
	// Drop every observed sighting, so what's left is fixes that held and issues not observed.
	const ledger = passing(KI_LEDGER).replace(/^Issue: #\d+ observed.*\n/gm, '').replace(/ - Also observed #\d+/g, '');
	const f = findingsOf(renderReportHtml(NO_FINDINGS, { ledger, knownIssues: KI_ISSUES }));
	assert.doesNotMatch(f, /ki-grp|row-head/);
	assert.match(f, /<span class="ki-empty-sum"><b>\d+<\/b> passed[\s\S]*?<span class="ki-cnt"[^>]*aria-controls="ki-list-fix">\d+ fix(es)? verified<\/span>[\s\S]*?<span class="ki-cnt"[^>]*aria-controls="ki-list-no">\d+ linked issues? not observed<\/span><\/span>/);
	assert.match(f, /<div class="ki-list" id="ki-list-no" hidden>/);
	assert.match(f, /<div class="ki-list" id="ki-list-fix" hidden>/);
});

test('with no findings and no linked issues, only the empty state shows', () => {
	const f = findingsOf(renderReportHtml(NO_FINDINGS, { ledger: passing(KI_LEDGER).replace(/^Issue: .*\n/gm, '') }));
	assert.doesNotMatch(f, /row-head|ki-grp|ki-list/);
	assert.match(f, /ki-empty/);
	assert.ok(!renderReportHtml(NO_FINDINGS).includes("closest('.ki-cnt')"), 'no list script');
});

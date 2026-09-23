/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReport, safeUrl } from './report-parse.mjs';
import { renderReportHtml } from './html.mjs';

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
	'**Only under:** shipped defaults.',
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
	'_explore: $3.12 | 77/200 turns | 26m_',
	'_verify: $0.63 | 31 turns_',
	'_total: $3.75_',
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

test('parseReport takes origin from the table, mapping unclear to Not checked', () => {
	const r = parseReport(FULL);
	assert.equal(r.findings[0].origin.label, 'New in this change');
	assert.equal(r.findings[1].origin.label, 'Pre-existing');

	const unclear = parseReport(md([
		'## Findings', '',
		'| # | Finding | Severity | Introduced? |',
		'|---|---|---|---|',
		'| 1 | a claim | minor | unclear |',
		'', '### Finding 1: a claim', '', 'prose.',
	].join('\n')));
	assert.equal(unclear.findings[0].origin.kind, 'unchecked');
	assert.equal(unclear.findings[0].origin.label, 'Not checked');
});

test('parseReport breaks a finding into its labelled parts', () => {
	const f = parseReport(FULL).findings[0];
	assert.match(f.observedHtml, /it spun forever/);
	assert.match(f.expectedHtml, /it should have stopped/);
	assert.match(f.onlyUnderHtml, /shipped defaults/);
	assert.match(f.reproStartHtml, /a console with pandas/);
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
	assert.equal(cost.duration, '26m');
	assert.deepEqual(cost.passes.map(p => p.label), ['explore', 'verify']);
	assert.equal(cost.passes[0].maxTurns, '200');
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
	assert.ok(card.indexOf('01-stuck.png') > card.indexOf('>Evidence<'));
	assert.doesNotMatch(card.slice(card.indexOf('>Reproduce<'), card.indexOf('>Evidence<')), /<img /);
});

test('renderReportHtml sizes the evidence gallery to the number of items', () => {
	const gallery = body => {
		const html = renderReportHtml(md([
			'## Findings', '',
			'| # | Finding | Severity |', '|---|---|---|', '| 1 | a claim | minor |',
			'', '### Finding 1: a claim', '', '**Evidence**', '', ...body,
		].join('\n')));
		return (/<div class="shots (n\d)"/.exec(html) || [])[1];
	};
	const shot = n => `- [shots/${n}.png](https://cdn.example/shots/${n}.png) -- shot ${n}`;
	assert.equal(gallery([shot(1)]), 'n1');
	assert.equal(gallery([shot(1), shot(2)]), 'n2');
	assert.equal(gallery([shot(1), shot(2), shot(3)]), 'n3');
	// Four or more wrap in the four-column grid.
	assert.equal(gallery([shot(1), shot(2), shot(3), shot(4), shot(5)]), 'n4');
});

test('renderReportHtml renders a run with no findings and no issues', () => {
	const html = renderReportHtml(md([
		'## Coverage', '', '### Verified', '',
		'| Scenario | Result | Screenshot |', '|---|---|---|',
		'| pandas frame | everything loads | |',
	].join('\n')));
	assert.doesNotMatch(html, /id="findings"/);
	assert.match(html, /<div class="tile-num">0<\/div>/);
	// One scenario, all passing: no issue segment and no not-run segment.
	assert.match(html, /<span>1 pass<\/span>/);
	assert.doesNotMatch(html, /issues/);
	assert.doesNotMatch(html, /not run/);
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

test('renderReportHtml counts each coverage table on its own heading', () => {
	const html = renderReportHtml(FULL);
	assert.match(html, /<h3 class="cov-title">Exercised<span class="cov-n"> &middot; 3<\/span><\/h3>/);
	assert.match(html, /<h3 class="cov-title">Not exercised<span class="cov-n"> &middot; 1<\/span><\/h3>/);
	// The section label carries nothing beside it any more, and neither count is
	// written as a phrase or in brackets.
	assert.match(html, /<div class="section-head"><h2 class="section-label">Coverage<\/h2><\/div>/);
	assert.doesNotMatch(html, /\d+ exercised/);
	assert.doesNotMatch(html, /Exercised \(/);
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
	assert.match(html, /\.coverage-grid\{grid-template-columns:minmax\(0,5fr\) minmax\(0,7fr\) 200px\}/);
});

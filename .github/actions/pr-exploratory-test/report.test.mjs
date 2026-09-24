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
import { parseLedger, parseReport, safeUrl } from './report-parse.mjs';
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

test('parseReport takes origin from the table: New, Pre-existing, Exposed, and Not checked only when blank', () => {
	const r = parseReport(FULL);
	assert.equal(r.findings[0].origin.label, 'New');
	assert.equal(r.findings[1].origin.label, 'Pre-existing');

	const origin = (value, strip = '') => parseReport(md([
		'## Findings', '',
		'| # | Finding | Severity | Introduced? |',
		'|---|---|---|---|',
		`| 1 | a claim | minor | ${value} |`,
		'', '### Finding 1: a claim', '', strip, '', 'prose.',
	].join('\n'))).findings[0].origin;
	assert.equal(origin('yes').label, 'New');
	assert.equal(origin('no').label, 'Pre-existing');
	assert.equal(origin('exposed').label, 'Exposed');
	// `unclear` is the old name for `exposed`; earlier reports keep rendering.
	assert.equal(origin('unclear').label, 'Exposed');
	assert.equal(origin('').label, 'Not checked');
	assert.equal(origin('maybe').label, 'Not checked');
	assert.equal(origin('', '> **Confirmed** | Reproduced **2/2** | **Introduced by this change**').label, 'New');
	assert.equal(origin('', '> **Confirmed** | Reproduced **2/2** | **Pre-existing**').label, 'Pre-existing');
	assert.equal(origin('', '> **Confirmed** | Reproduced **2/2** | **Exposed by this change**').label, 'Exposed');
	assert.equal(origin('', '> **Confirmed** | Reproduced **2/2** | **Origin unclear**').label, 'Exposed');
});

test('the Findings table puts Origin beside Severity, one plain style for every label, with tooltips', () => {
	const html = renderReportHtml(FULL);
	const head = /<div class="row row-head findings-grid">(.*?)<\/div>/.exec(html)[1];
	assert.deepEqual([...head.matchAll(/<span[^>]*>([^<]*)<\/span>/g)].map(m => m[1]),
		['Severity', 'Origin', 'Finding and impact', 'Reproduced', 'Status']);
	assert.match(head, /<span class="org-tip" tabindex="0" data-tip="Judged from the diff: does the code each finding blames come from this change\?">Origin<\/span>/);
	// Rows are links, so each cell's tooltip is a native title rather than a focusable element.
	assert.match(html, /<span class="origin-cell"><span class="org" title="New: the code this finding blames was added or changed in this diff\.">New<\/span><\/span>/);
	assert.match(html, /<span class="org" title="Pre-existing: the code this finding blames predates this diff\.">Pre-existing<\/span>/);
	assert.match(html, /\.findings-grid\{grid-template-columns:110px 96px minmax\(0,1fr\) 90px 110px\}/);
	assert.match(html, /\.org\{color:inherit;font-weight:inherit\}/);
	assert.doesNotMatch(html, /\.org[^{]*\.new|origin-cell\.new/);
	// The card's label is not inside a link, so it takes focus and shows its tooltip on hover or focus.
	assert.match(html, /<span class="org org-tip" tabindex="0" data-tip="New: the code this finding blames was added or changed in this diff\.">New<\/span>/);
	assert.match(html, /\.org-tip:hover::after,\.org-tip:focus-visible::after\{content:attr\(data-tip\)/);
});

test('the prompt gives the origin label and its reason', () => {
	const prompt = value => promptText(renderReportHtml(md([
		'## Findings', '',
		'| # | Finding | Severity | Introduced? |',
		'|---|---|---|---|',
		`| 1 | a claim | minor | ${value} |`,
		'', '### Finding 1: a claim', '', 'prose.',
	].join('\n'))), 1);
	assert.match(prompt('exposed'), /^Origin: Exposed \(the broken code predates this diff, but this change made it reachable or changed the timing\)$/m);
	assert.match(prompt(''), /^Origin: Not checked \(the run didn't record it\)$/m);
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
	assert.doesNotMatch(html, /id="findings"/);
	assert.match(html, /<div class="tile-num">0<\/div>/);
	// One scenario, all passing: no issue segment and no not-run segment.
	assert.match(html, /<b>1<\/b> pass/);
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

test('renderReportHtml counts each coverage kind on its filter tab', () => {
	const html = renderReportHtml(FULL);
	const tabs = html.slice(html.indexOf('<div class="cf-tabs">'), html.indexOf('<div class="panel cf-card">'));
	const counts = [...tabs.matchAll(/<span class="cf-l">([^<]+) <span class="cf-cnt">(\d+)<\/span><\/span>/g)].map(m => `${m[1]} ${m[2]}`);
	assert.deepEqual(counts, ['All 4', 'Issues 1', 'Passed 2', 'Not run 1']);
	// A hidden semibold copy holds each tab's selected width.
	assert.match(tabs, /<span class="cf-g" aria-hidden="true">Passed 2<\/span><\/label>/);
	// One radio per tab, All checked, all ahead of the tabs and the card.
	assert.match(html, /<input type="radio" name="cf" id="cf-all" class="cf-radio" checked><input type="radio" name="cf" id="cf-i" class="cf-radio"><input type="radio" name="cf" id="cf-p" class="cf-radio"><input type="radio" name="cf" id="cf-n" class="cf-radio">\n<div class="cf-tabs">/);
	// One table: no subheadings, no dashed second table.
	assert.doesNotMatch(html, /cov-title|panel dashed|cov-group/);
	assert.match(html, /<div class="section-head"><h2 class="section-label">Coverage<\/h2><\/div>/);
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
	assert.match(tiles, /<b>2<\/b> pass<\/span><span class="legend-sep" aria-hidden="true">&middot;<\/span><span class="legend-item"><b>1<\/b> issues<\/span><span class="legend-sep" aria-hidden="true">&middot;<\/span><span class="legend-item"><b>1<\/b> not run/);
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
		'Origin: New (the blamed code was added or changed in this diff)',
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
	assert.match(html, /<span class="group context">[\s\S]*?<\/span><button type="button" class="cp-btn" data-tip="Copy prompt for agent" data-prompt="prompt-f1" aria-label="Copy prompt for an agent: finding 1"><svg class="cp-ico"[\s\S]*?<\/button><\/div>/);
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
	assert.doesNotMatch(html, /cp-btn"|text\/plain|querySelectorAll\('\.cp-btn,\.code-cp'\)/);
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
	'| # | Finding | Severity | Introduced? | Reproduction |', '|---|---|---|---|---|',
	'| 1 | a claim | major | yes | 3/3 |',
	'| 2 | b claim | minor | no | 1/1 |',
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
	assert.match(cov, /<details class="cv cf-r cf-p" id="cv-row-\d+"><summary class="row coverage-grid"><span class="cov-scenario"><span class="cov-dot pass"[^>]*><\/span><span>pandas frame<\/span><\/span>[\s\S]*?<span class="cv-chev-cell"><svg class="cv-chev"[\s\S]*?<\/summary><div class="cv-steps"><ol class="steps"><li>Build <code>df<\/code>\.<\/li>\n<li>Run <code>%view df<\/code>\.<\/li><\/ol><\/div><\/details>/);
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
	assert.doesNotMatch(JSON.stringify(cov), /CDP 44987/);
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

test('ledger: Coverage and the Scenarios tile come from the ledger, not the report tables', () => {
	const report = parseReport(TYPED, { ledger: LEDGER });
	assert.deepEqual(report.scenarios, { exercised: 8, pass: 6, issues: 2, notRun: 3 });
	const html = renderReportHtml(TYPED, { ledger: LEDGER });
	const cov = coverageOf(html);
	// One table: no subheadings, no second table.
	assert.doesNotMatch(cov, /Exercised|Not exercised|<h3/);
	assert.match(cov, /cf-tab-all"><span class="cf-l">All <span class="cf-cnt">11<\/span>/);
	assert.match(cov, /cf-tab-i"><span class="cf-l">Issues <span class="cf-cnt">2<\/span>/);
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
	assert.deepEqual(ledger.logs.map(l => l.path), ['logs/44987-app.log', 'logs/exthost.log', 'logs/python-console.log', 'logs/slow.py']);
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
	assert.deepEqual(labels, ['Agents', 'Change under test', 'Environment', 'State manipulation', 'Test ledger', 'Logs', 'Branch verification']);
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

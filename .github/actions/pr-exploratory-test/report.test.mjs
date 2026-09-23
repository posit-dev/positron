/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReport, safeUrl } from './report-parse.mjs';
import { renderReportHtml, visibleExercisedCount } from './html.mjs';

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
	assert.doesNotMatch(bare, /Preconditions/);
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
	assert.match(f.steps[0], /<pre><code>/);
	assert.match(f.steps[0], /&lt;div class=&quot;alert&quot;&gt;/);
	assert.match(f.steps[1], /Render the cell/);
	assert.match(f.steps[2], /Show Details/);
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
	const step = r.findings[0].steps[0];
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

test('visibleExercisedCount shows findings plus 4 passes, at least 6, all at 8 or fewer', () => {
	const rows = (findings, passes) => [
		...Array.from({ length: findings }, (_, i) => ({ finding: i + 1 })),
		...Array.from({ length: passes }, () => ({ finding: null })),
	];
	assert.equal(visibleExercisedCount(rows(2, 6)), 8);
	assert.equal(visibleExercisedCount(rows(1, 17)), 6);
	assert.equal(visibleExercisedCount(rows(0, 18)), 6);
	assert.equal(visibleExercisedCount(rows(5, 13)), 9);
	assert.equal(visibleExercisedCount(rows(9, 1)), 10);
});

test('renderReportHtml puts finding rows first and collapses the passes past the first 4', () => {
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
	const order = [...html.matchAll(/<span>((?:pass|first|second) [^<]*)<\/span>/g)].map(m => m[1]);
	assert.deepEqual(order.slice(0, 7), ['first hit', 'second hit', 'pass 1', 'pass 2', 'pass 3', 'pass 4', 'pass 5']);
	assert.equal((html.slice(html.indexOf('<body')).match(/cov-extra/g) || []).length, 6);
	assert.match(html, /<h3 class="cov-title">Exercised<span class="cov-n"> &middot; 12<\/span>/);
	assert.match(html, /<input type="checkbox" id="cov-all" class="cov-toggle" aria-label="Show all 12 exercised scenarios">/);
	assert.match(html, /<label for="cov-all" class="cov-more"><span class="cov-all">Show all 12 exercised scenarios<\/span><span class="cov-less">Show fewer<\/span>/);
	// Not exercised never collapses, however long.
	const not = html.slice(html.indexOf('Not exercised'));
	assert.doesNotMatch(not, /cov-extra|cov-toggle/);
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
		assert.match(html, /<h3 class="cov-title">Not exercised<\/h3>\n<p class="cov-empty">Everything in scope was exercised\.<\/p>/, cell);
		// A zero count gets no bar segment and no legend item.
		const tiles = html.slice(html.indexOf('<section class="tiles">'), html.indexOf('</section>'));
		assert.doesNotMatch(tiles, /not run|notrun-bar/, cell);
	}
});

test('renderReportHtml styles the Reason header like every other column header', () => {
	const html = renderReportHtml(FULL);
	assert.match(html, /<span class="cov-head-scenario">Scenario<\/span><span class="cov-head-reason">Reason<\/span>/);
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
		'Introduced by this change: Yes',
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
	assert.match(html, /document\.querySelectorAll\('\.cp-btn'\)/);
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

test('renderReportHtml renders no prompt buttons, blocks or script when agent prompts are off', () => {
	const html = renderReportHtml(FULL, { agentPrompts: false });
	assert.doesNotMatch(html, /cp-btn"|text\/plain|querySelectorAll\('\.cp-btn'\)/);
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

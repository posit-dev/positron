/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderReportHtml } from './html.mjs';
import { pickReport, buildCostRecord, renderCostFooter, resolveReport, buildShotsBaseUrl, parsePosIntEnv, parseVerdicts, annotateFindingsTable, hasFindings, parseGate } from './lib.mjs';

test('pickReport returns the last message containing a triage table', () => {
	const messages = ['thinking out loud', '# Report\n\n| # | Finding | Type |\n|---|---|---|\n| 1 | x | bug |'];
	assert.match(pickReport(messages), /Finding/);
});

test('pickReport returns null when no message looks like a report', () => {
	assert.equal(pickReport(['hello', 'still working']), null);
});

test('pickReport prefers the latest report when several qualify', () => {
	const messages = [
		'# Report\n\n| # | Finding | Type |\n|---|---|---|\n| 1 | first | bug |',
		'# Report\n\n| # | Finding | Type |\n|---|---|---|\n| 1 | second | bug |',
	];
	assert.match(pickReport(messages), /second/);
});

test('buildCostRecord extracts the fields the spec names', () => {
	const record = buildCostRecord({
		type: 'result',
		total_cost_usd: 1.2345,
		num_turns: 87,
		duration_ms: 1500000,
		usage: {
			input_tokens: 10,
			cache_read_input_tokens: 4000,
			cache_creation_input_tokens: 300,
			output_tokens: 20,
		},
	});
	assert.equal(record.total_cost_usd, 1.2345);
	assert.equal(record.num_turns, 87);
	assert.equal(record.duration_ms, 1500000);
	assert.equal(record.input_tokens, 10);
	assert.equal(record.cache_read_input_tokens, 4000);
	assert.equal(record.cache_creation_input_tokens, 300);
	assert.equal(record.output_tokens, 20);
});

test('buildCostRecord nulls the cache fields when the SDK omits them', () => {
	const record = buildCostRecord({ type: 'result', usage: { input_tokens: 10 } });
	assert.equal(record.cache_read_input_tokens, null);
	assert.equal(record.cache_creation_input_tokens, null);
});

test('buildCostRecord tolerates a result message missing usage', () => {
	const record = buildCostRecord({ type: 'result' });
	assert.equal(record.input_tokens, null);
	assert.equal(record.total_cost_usd, null);
});

test('renderCostFooter reports cost, turns against the cap, and wall clock', () => {
	const footer = renderCostFooter([{ label: 'explore', main: true, cost: { total_cost_usd: 1.2, num_turns: 87, duration_ms: 1500000 } }], 200);
	assert.match(footer, /\$1\.20/);
	assert.match(footer, /87\/200 turns/);
	assert.match(footer, /25m/);
});

test('renderCostFooter degrades gracefully with no result message', () => {
	const footer = renderCostFooter([{ label: 'explore', main: true, cost: { total_cost_usd: null, num_turns: null, duration_ms: null } }], 200);
	assert.match(footer, /unknown/);
});

test('resolveReport prefers a non-empty report.md over scraped chat text, verbatim', () => {
	const fileReport = '# Report\n\n| # | Finding | Type |\n|---|---|---|\n| 1 | from file | bug |';
	const messages = ['# Report\n\n| # | Finding | Type |\n|---|---|---|\n| 1 | from chat | bug |'];
	assert.equal(resolveReport(fileReport, messages), fileReport);
});

test('resolveReport falls back to pickReport when report.md is missing (null)', () => {
	const messages = ['thinking', '# Report\n\n| # | Finding | Type |\n|---|---|---|\n| 1 | from chat | bug |'];
	assert.match(resolveReport(null, messages), /from chat/);
});

test('resolveReport falls back to pickReport when report.md is empty or whitespace-only', () => {
	const messages = ['# Report\n\n| # | Finding | Type |\n|---|---|---|\n| 1 | from chat | bug |'];
	assert.match(resolveReport('   \n', messages), /from chat/);
});

test('resolveReport returns null when the file is absent and no message looks like a report', () => {
	assert.equal(resolveReport(null, ['hello', 'still working']), null);
});

test('buildShotsBaseUrl passes through a base URL with no trailing slash', () => {
	assert.equal(
		buildShotsBaseUrl('https://d38p2avprg8il3.cloudfront.net/playwright-report-1-1-exploratory-ubuntu'),
		'https://d38p2avprg8il3.cloudfront.net/playwright-report-1-1-exploratory-ubuntu'
	);
});

test('buildShotsBaseUrl trims exactly one trailing slash', () => {
	assert.equal(
		buildShotsBaseUrl('https://d38p2avprg8il3.cloudfront.net/playwright-report-1-1-exploratory-ubuntu/'),
		'https://d38p2avprg8il3.cloudfront.net/playwright-report-1-1-exploratory-ubuntu'
	);
});

test('buildShotsBaseUrl returns empty string when no CDN base is configured', () => {
	assert.equal(buildShotsBaseUrl(''), '');
});

test('parsePosIntEnv returns the parsed value for a valid positive integer string', () => {
	assert.equal(parsePosIntEnv('MAX_TURNS', 200, '87'), 87);
});

test('parsePosIntEnv falls back to the default for an unset value', () => {
	assert.equal(parsePosIntEnv('MAX_TURNS', 200, undefined), 200);
});

test('parsePosIntEnv falls back to the default for an empty string', () => {
	assert.equal(parsePosIntEnv('MAX_TURNS', 200, ''), 200);
});

test('parsePosIntEnv falls back to the default for "0"', () => {
	assert.equal(parsePosIntEnv('MAX_TURNS', 200, '0'), 200);
});

test('parsePosIntEnv falls back to the default for a non-numeric string', () => {
	assert.equal(parsePosIntEnv('MAX_TURNS', 200, 'abc'), 200);
});

const TABLE = [
	'# Exploratory test: something',
	'',
	'## Findings',
	'',
	'| # | Finding | Severity | Impact | Introduced? | Reproduction |',
	'|---|---------|----------|--------|-------------|--------------|',
	'| 1 | first claim | major | blocks completion | yes | 3/3 |',
	'| 2 | second claim | minor | cosmetic | yes | 2/2 |',
	'',
	'### 1. first claim',
].join('\n');

test('parseVerdicts reads the machine-readable line', () => {
	const v = parseVerdicts('preamble\nVERDICTS: 1=CONFIRMED; 2=FALSE POSITIVE\nprose');
	assert.equal(v.get(1), 'confirmed');
	assert.equal(v.get(2), 'disputed');
});

test('parseVerdicts returns empty when the line is absent', () => {
	assert.equal(parseVerdicts('no verdict line here').size, 0);
	assert.equal(parseVerdicts(null).size, 0);
});

test('annotateFindingsTable adds a verdict per row', () => {
	const out = annotateFindingsTable(TABLE, parseVerdicts('VERDICTS: 1=CONFIRMED; 2=FALSE POSITIVE'));
	assert.match(out, /\| # \| Finding \| Severity \| Impact \| Introduced\? \| Reproduction \| Verified \|/);
	assert.match(out, /\| 1 \| first claim .* \| confirmed \|/);
	assert.match(out, /\| 2 \| second claim .* \| disputed \|/);
});

test('annotateFindingsTable marks rows the verifier did not rule on', () => {
	const out = annotateFindingsTable(TABLE, parseVerdicts('VERDICTS: 1=CONFIRMED'));
	assert.match(out, /\| 2 \| second claim .* \| - \|/);
});

test('annotateFindingsTable leaves a report it cannot parse untouched', () => {
	const noTable = '# Report\n\n## Findings\n\nNo findings.\n';
	assert.equal(annotateFindingsTable(noTable, parseVerdicts('VERDICTS: 1=CONFIRMED')), noTable);
	assert.equal(annotateFindingsTable(TABLE, new Map()), TABLE);
});

test('hasFindings distinguishes a populated table from an empty one', () => {
	assert.equal(hasFindings(TABLE), true);
	assert.equal(hasFindings('## Findings\n\nNo findings.\n'), false);
	assert.equal(hasFindings([
		'| # | Finding | Severity |',
		'|---|---------|----------|',
		'| - | none | - |',
	].join('\n')), false);
	assert.equal(hasFindings(null), false);
});

test('parseGate reads a bail-out with its blocker', () => {
	const g = parseGate('prose\nGATE: NOT TESTABLE - the server side is unreleased (kallichore#77)\nmore');
	assert.equal(g.testable, false);
	assert.match(g.reason, /unreleased/);
});

test('parseGate reads a pass', () => {
	assert.equal(parseGate('GATE: TESTABLE').testable, true);
});

test('parseGate refuses a bail-out with no stated blocker', () => {
	assert.equal(parseGate('GATE: NOT TESTABLE'), null);
	assert.equal(parseGate('GATE: NOT TESTABLE -   '), null);
});

test('parseGate returns null when it cannot tell, so the run proceeds', () => {
	assert.equal(parseGate('no gate line'), null);
	assert.equal(parseGate('GATE: maybe?'), null);
	assert.equal(parseGate(null), null);
});

test('renderCostFooter renders passes in the order they ran, then a total', () => {
	const footer = renderCostFooter([
		{ label: 'gate', cost: { total_cost_usd: 0.01, num_turns: 3 } },
		{ label: 'explore', main: true, cost: { total_cost_usd: 2.52, num_turns: 67, duration_ms: 930000 } },
		{ label: 'verify', cost: { total_cost_usd: 0.48, num_turns: 24 } },
	], 200);
	const lines = footer.split('\n');
	assert.match(lines[0], /gate: \$0\.01 \| 3 turns/);
	assert.match(lines[1], /explore: \$2\.52 \| 67\/200 turns \| 16m/);
	assert.match(lines[2], /verify: \$0\.48 \| 24 turns/);
	assert.match(lines[3], /total: \$3\.01/);
});

test('renderCostFooter omits passes that did not run, and the total with them', () => {
	const footer = renderCostFooter([
		{ label: 'gate', cost: { total_cost_usd: null } },
		{ label: 'explore', main: true, cost: { total_cost_usd: 2.52, num_turns: 67, duration_ms: 930000 } },
		{ label: 'verify', cost: { total_cost_usd: null } },
	], 200);
	assert.doesNotMatch(footer, /gate|verify|total/);
	assert.match(footer, /explore: \$2\.52/);
});

const REPORT_MD = [
	'# Exploratory test: something',
	'',
	'`branch/name` | `abc1234`',
	'',
	'**Result:** It works.',
	'',
	'## Findings',
	'',
	'| # | Finding | Verified |',
	'|---|---------|----------|',
	'| 1 | a claim | confirmed |',
	'',
	'<details>',
	'<summary>Run details</summary>',
	'',
	'the details',
	'',
	'</details>',
].join('\n');

test('renderReportHtml lifts the title and meta into the header, once', () => {
	const html = renderReportHtml(REPORT_MD);
	// "Exploratory test:" becomes the eyebrow, so the h1 carries only the subject.
	assert.match(html, /<div class="eyebrow">Exploratory test<\/div>/);
	assert.match(html, /<h1>something<\/h1>/);
	assert.match(html, /<div class="meta">.*branch\/name.*<\/div>/);
	assert.equal((html.match(/<h1>/g) || []).length, 1);
});

test('renderReportHtml puts the outcome in the hero and coverage below it', () => {
	const md = [
		'# T', '', '`b` | `s`', '',
		'**Result:** it works.',
		'**Tested:** two things, 2 scenarios',
		'**Not exercised:** a surface; another surface',
		'',
		'## Findings', '',
		'| # | Finding | Severity | Verified |',
		'|---|---------|----------|----------|',
		'| 1 | a claim | major | confirmed |',
		'| 2 | b claim | minor | confirmed |',
	].join('\n');
	const html = renderReportHtml(md);
	const hero = html.slice(html.indexOf('<div class="header">'), html.indexOf('<div class="coverage">'));
	// The hero carries the count and the outcome, and nothing else.
	assert.match(hero, /<div class="count">2 findings<\/div>/);
	assert.match(hero, /1 major/);
	assert.match(hero, /<p class="lead">it works\.<\/p>/);
	// The breakdown describes findings only: a coverage number here read as
	// another kind of finding.
	assert.doesNotMatch(hero, /not exercised/);
	assert.doesNotMatch(hero, /two things/);
	assert.match(html, /<span class="k">Coverage<\/span>two things, 2 scenarios/);
});

test('renderReportHtml counts the Not exercised table, not the summary prose', () => {
	const md = [
		'# T', '', '`b` | `s`', '',
		'**Result:** it works.',
		'**Tested:** things, 2 scenarios',
		'**Not exercised:** a; b, c',
		'',
		'## Coverage', '', '### Not exercised', '',
		'| Scenario | Reason |',
		'|---|---|',
		'| a | because |',
		'| b | because |',
		'| c | because |',
		'| d | because |',
	].join('\n');
	// The prose lists three, the table has four. The table is what a reader checks.
	assert.match(renderReportHtml(md), /4 not exercised/);
});

test('renderReportHtml says "No findings" when the table is empty', () => {
	const md = '# T\n\n`b` | `s`\n\n**Result:** clean.\n**Not exercised:** none\n\n## Findings\n\nNo findings.\n';
	const html = renderReportHtml(md);
	assert.match(html, /<div class="count">No findings<\/div>/);
	// No Not exercised table, so no count to show.
	assert.doesNotMatch(html, /not exercised/);
});

test('renderReportHtml leaves bold labels inside the body alone', () => {
	const md = '# T\n\n`b` | `s`\n\n## Findings\n\n**Observed:** a thing\n**Expected:** another\n';
	const html = renderReportHtml(md);
	// Past the first section these are finding fields, not the summary.
	assert.equal((html.match(/<div class="line">/g) || []).length, 0);
	assert.match(html.slice(html.indexOf('class="card"')), /Observed:/);
});

test('renderReportHtml renders tables and passes details through', () => {
	const html = renderReportHtml(REPORT_MD);
	assert.match(html, /<table>/);
	assert.match(html, /<td>confirmed<\/td>/);
	assert.match(html, /<details>/);
	assert.doesNotMatch(html, /^\| 1 \|/m);
});

test('renderReportHtml escapes a title that contains markup', () => {
	const html = renderReportHtml('# A <script>alert(1)</script> title\n\nbody');
	assert.doesNotMatch(html, /<title>[^<]*<script>/);
	assert.match(html, /&lt;script&gt;/);
});

test('renderReportHtml survives a report with no title', () => {
	const html = renderReportHtml('just prose, no heading');
	assert.match(html, /<h1>Exploratory test<\/h1>/);
	assert.match(html, /just prose/);
});

test('renderReportHtml turns an evidence screenshot into a captioned thumbnail', () => {
	const md = [
		'# T', '', '`b` | `s`', '', '## Findings', '',
		'**Evidence**', '',
		'- [shots/01-stuck.png](https://cdn.example/shots/01-stuck.png) -- the spinner, 60s later',
		'- `logs/app.log` -- `RPC timed out after 5 seconds`',
	].join('\n');
	const html = renderReportHtml(md);
	assert.match(html, /<li class="shot">/);
	assert.match(html, /<img src="https:\/\/cdn\.example\/shots\/01-stuck\.png"/);
	assert.match(html, /target="_blank"/);
	assert.match(html, /<div class="cap">the spinner, 60s later<\/div>/);
	// The log bullet is not an image and stays an ordinary list item.
	assert.match(html, /<li><code>logs\/app\.log<\/code>/);
	assert.equal((html.match(/<li class="shot">/g) || []).length, 1);
});

test('renderReportHtml falls back to the filename when a shot has no caption', () => {
	const md = '# T\n\n`b` | `s`\n\n## Findings\n\n- [shots/02.png](https://cdn.example/shots/02.png)\n';
	const html = renderReportHtml(md);
	assert.match(html, /<div class="cap">shots\/02\.png<\/div>/);
});

test('renderReportHtml makes the embedded hero image openable and caps its height', () => {
	const md = '# T\n\n`b` | `s`\n\n## Findings\n\n![](https://cdn.example/shots/hero.png)\n';
	const html = renderReportHtml(md);
	assert.match(html, /<a class="hero" href="https:\/\/cdn\.example\/shots\/hero\.png" target="_blank"/);
	assert.match(html, /a\.hero img \{[^}]*max-height: 420px/);
	// Every image on the page opens full size: none is left bare.
	const total = (html.match(/<img /g) || []).length;
	const linked = (html.match(/<a [^>]*><img /g) || []).length;
	assert.equal(total, linked);
});

test('renderReportHtml rules a finding heading but not a section heading', () => {
	const md = [
		'# T', '', '`b` | `s`', '',
		'## Findings', '', '### Finding 1: a claim', '', 'body', '',
		'## Coverage', '', '### Verified', '', '| a | b |', '|---|---|', '| c | d |',
	].join('\n');
	const html = renderReportHtml(md);
	assert.match(html, /<h3 class="finding">Finding 1: a claim<\/h3>/);
	// Verified sits under the Coverage rule; a second rule there reads as an empty band.
	assert.match(html, /<h3>Verified<\/h3>/);
	assert.equal((html.match(/<h3 class="finding"/g) || []).length, 1);
});

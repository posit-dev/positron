/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildVerifyPrompt, buildTaskLine, pickReport, buildCostRecord, renderCostFooter, resolveReport, buildShotsBaseUrl, parsePosIntEnv, fromVerdictLine, parseVerdicts, annotateFindingsTable, hasFindings, parseGate, renderStepSummary, renderSummaryTarget, COMMENT_MARKER, runOutcome, renderPrComment, withPrLine, isProductPath } from './lib.mjs';

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
		buildShotsBaseUrl('https://d38p2avprg8il3.cloudfront.net/exploratory-report-1-1-opus-ubuntu'),
		'https://d38p2avprg8il3.cloudfront.net/exploratory-report-1-1-opus-ubuntu'
	);
});

test('buildShotsBaseUrl trims exactly one trailing slash', () => {
	assert.equal(
		buildShotsBaseUrl('https://d38p2avprg8il3.cloudfront.net/exploratory-report-1-1-opus-ubuntu/'),
		'https://d38p2avprg8il3.cloudfront.net/exploratory-report-1-1-opus-ubuntu'
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
	'| # | Finding | Severity | Impact | Reproduction |',
	'|---|---------|----------|--------|--------------|',
	'| 1 | first claim | major | blocks completion | 3/3 |',
	'| 2 | second claim | minor | cosmetic | 2/2 |',
	'',
	'### 1. first claim',
].join('\n');

test('parseVerdicts reads the machine-readable line', () => {
	const v = parseVerdicts('preamble\nVERDICTS: 1=CONFIRMED; 2=FALSE POSITIVE\nprose');
	assert.equal(v.get(1), 'confirmed');
	assert.equal(v.get(2), 'disputed');
});

test('fromVerdictLine drops the notes before the VERDICTS line', () => {
	const reply = 'No conflicting evidence. I have enough to finalize.\n\nVERDICTS: 1=CONFIRMED\n\n- **Finding 1**: CONFIRMED.';
	assert.equal(fromVerdictLine(reply), 'VERDICTS: 1=CONFIRMED\n\n- **Finding 1**: CONFIRMED.');
	assert.equal(fromVerdictLine('VERDICTS: 1=CONFIRMED\nwhy'), 'VERDICTS: 1=CONFIRMED\nwhy');
	// No verdict line: keep everything, since the prose is all the reviewer gets.
	assert.equal(fromVerdictLine('just prose'), 'just prose');
	assert.equal(fromVerdictLine(null), null);
});

test('parseVerdicts returns empty when the line is absent', () => {
	assert.equal(parseVerdicts('no verdict line here').size, 0);
	assert.equal(parseVerdicts(null).size, 0);
});

test('annotateFindingsTable adds a verdict per row', () => {
	const out = annotateFindingsTable(TABLE, parseVerdicts('VERDICTS: 1=CONFIRMED; 2=FALSE POSITIVE'));
	assert.match(out, /\| # \| Finding \| Severity \| Impact \| Reproduction \| Verified \|/);
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
	// The total covers every pass in money and in time.
	assert.match(lines[3], /total: \$3\.01 \| 16m/);
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

const SUMMARY_MD = [
	'# Exploratory test: something',
	'',
	'`branch/name` | `abc1234`',
	'',
	'**Result:** It works.',
	'',
	'## Findings',
	'',
	'| # | Finding | Severity |',
	'|---|---------|----------|',
	'| 1 | a claim | major |',
	'| 2 | b claim | moderate |',
	'| 3 | c claim | moderate |',
	'| 4 | d claim | minor |',
	'| 5 | e claim | minor |',
	'',
	'### Finding 1: a claim',
	'',
	'**Observed:** it broke.',
].join('\n');

test('renderStepSummary is a tally and two links, and nothing else', () => {
	const summary = renderStepSummary(SUMMARY_MD, 'https://cdn.example/run');
	assert.match(summary, /^\*\*1 major \u00b7 2 moderate \u00b7 2 minor\*\*$/m);
	assert.match(summary, /\[Exploratory Test Report\]\(https:\/\/cdn\.example\/run\/index\.html\)/);
	assert.match(summary, /\[Agent Report\]\(https:\/\/cdn\.example\/run\/report\.md\)/);
	// The body of the report belongs on its own page, not pasted in here.
	assert.doesNotMatch(summary, /Observed|a claim/);
	// The links say what they are, and the cost is on the report's Run tile.
	assert.doesNotMatch(summary, /interactive report|structured Markdown/);
	// Only the tally is bold; the links carry their own weight as links.
	assert.doesNotMatch(summary, /\*\*\[|\]\([^)]*\)\*\*/);
	assert.doesNotMatch(summary, /\$|turns|explore|verify|total/);
	assert.equal(summary.trim().split('\n').filter(Boolean).length, 3);
});

test('renderStepSummary counts the table when the report wrote up no blocks', () => {
	// Only finding 1 has a block; the severities all come from the table.
	assert.match(renderStepSummary(SUMMARY_MD, ''), /\*\*1 major/);
});

test('renderStepSummary omits a breakdown it cannot read', () => {
	const md = '# T\n\n`b` | `s`\n\n## Findings\n\n| # | Finding |\n|---|---|\n| 1 | a claim |\n';
	const summary = renderStepSummary(md, 'https://cdn.example/run');
	// No Severity column, so no severity is claimed -- and never "1 minor".
	assert.match(summary, /^\*\*1 finding\*\*$/m);
	assert.doesNotMatch(summary, /minor/);
});

test('renderStepSummary says so when there is nothing to report', () => {
	const md = '# T\n\n`b` | `s`\n\n## Findings\n\nNo findings.\n';
	assert.match(renderStepSummary(md, 'https://cdn.example/run'), /\*\*No findings\*\*/);
});

test('renderStepSummary points at the artifact when nothing was published', () => {
	const summary = renderStepSummary(SUMMARY_MD, '');
	// A dead link is worse than no link.
	assert.doesNotMatch(summary, /\]\(/);
	assert.match(summary, /workflow artifact/);
});

test('renderCostFooter totals the time as well as the money', () => {
	const footer = renderCostFooter([
		{ label: 'explore', main: true, cost: { total_cost_usd: 0.99, num_turns: 20, duration_ms: 408211 } },
		{ label: 'verify', cost: { total_cost_usd: 0.31, num_turns: 14, duration_ms: 75643 } },
	], 200);
	// 6.8m of exploring and 1.3m of verifying is an 8m run, not a 7m one.
	assert.match(footer, /_explore: \$0\.99 \| 20\/200 turns \| 7m_/);
	assert.match(footer, /_verify: \$0\.31 \| 14 turns \| 1m_/);
	assert.match(footer, /_total: \$1\.30 \| 8m_/);
});

test('renderCostFooter does not report a pass that ran as taking no time', () => {
	const footer = renderCostFooter([
		{ label: 'explore', main: true, cost: { total_cost_usd: 0.10, num_turns: 2, duration_ms: 20000 } },
		{ label: 'verify', cost: { total_cost_usd: 0.05, num_turns: 1, duration_ms: 9000 } },
	], 200);
	// Rounding to minutes turned forty seconds of work into "0m".
	assert.doesNotMatch(footer, /\b0m\b/);
	assert.match(footer, /_explore: \$0\.10 \| 2\/200 turns \| <1m_/);
	assert.match(footer, /_total: \$0\.15 \| <1m_/);
});

test('buildCostRecord names the model that billed most', () => {
	const record = buildCostRecord({
		type: 'result',
		modelUsage: {
			'claude-haiku-4-5-20251001': { costUSD: 0.01 },
			'claude-opus-5-5': { costUSD: 1.2 },
		},
	});
	assert.equal(record.model, 'claude-opus-5-5');
	assert.equal(buildCostRecord({ type: 'result' }).model, null);
});

test('renderCostFooter leads a pass with its model when one is known', () => {
	const footer = renderCostFooter([
		{ label: 'explore', main: true, cost: { total_cost_usd: 1.2, num_turns: 25, duration_ms: 360000, model: 'claude-opus-5-5' } },
	], 200);
	assert.match(footer, /_explore: Opus 5\.5 \| \$1\.20 \| 25\/200 turns \| 6m_/);
});

test('runOutcome is complete when a report was written inside the turn cap', () => {
	assert.equal(runOutcome({ report: '# r', numTurns: 90, maxTurns: 200 }), 'complete');
});

test('runOutcome is partial at the turn cap, report or not', () => {
	assert.equal(runOutcome({ report: '# r', numTurns: 200, maxTurns: 200 }), 'partial');
	assert.equal(runOutcome({ report: null, numTurns: 200, maxTurns: 200 }), 'partial');
});

test('runOutcome is no-report when the agent stopped early without one', () => {
	assert.equal(runOutcome({ report: null, numTurns: 12, maxTurns: 200 }), 'no-report');
	// An SDK that never reported turns is not a partial run.
	assert.equal(runOutcome({ report: null, numTurns: null, maxTurns: 200 }), 'no-report');
});

const RUN_URL = 'https://github.com/posit-dev/positron/actions/runs/1';
const SHA = 'abc1234def5678';

test('renderPrComment carries the marker and a run or report link in every state', () => {
	for (const state of ['running', 'complete', 'partial', 'no-report', '', 'declined']) {
		const body = renderPrComment({ state, markdown: SUMMARY_MD, baseUrl: 'https://cdn.example/run', runUrl: RUN_URL, headSha: SHA });
		assert.ok(body.startsWith(COMMENT_MARKER), `state=${JSON.stringify(state)}`);
		assert.match(body, /\[View (run|report) \u2192\]\(https:\/\//, `state=${JSON.stringify(state)}`);
	}
});

test('renderPrComment on a finished run is a title, the tally and the report link', () => {
	const body = renderPrComment({ state: 'complete', markdown: SUMMARY_MD, baseUrl: 'https://cdn.example/run', runUrl: RUN_URL, headSha: SHA });
	assert.equal(body, `${COMMENT_MARKER}\n**\u{1F50E} Exploratory testing** abc1234\n\n1 major \u00b7 2 moderate \u00b7 2 minor\n[View report \u2192](https://cdn.example/run/index.html)\n`);
});

test('renderPrComment running state names the head and links the run', () => {
	const body = renderPrComment({ state: 'running', markdown: null, baseUrl: '', runUrl: RUN_URL, headSha: SHA });
	assert.equal(body, `${COMMENT_MARKER}\n**\u{1F50E} Exploratory testing** abc1234\n\nLooking for trouble\u2026\n[View run \u2192](${RUN_URL})\n`);
});

test('renderPrComment says No findings for an empty table', () => {
	const body = renderPrComment({ state: 'complete', markdown: '# X\n\nNo findings.\n', baseUrl: 'https://cdn.example/run', runUrl: RUN_URL, headSha: SHA });
	assert.match(body, /^No findings$/m);
});

test('renderPrComment points at the artifact when the upload failed', () => {
	const body = renderPrComment({ state: 'complete', markdown: SUMMARY_MD, baseUrl: '', runUrl: RUN_URL, headSha: SHA });
	assert.doesNotMatch(body, /cdn\.example|index\.html|View report/);
	assert.match(body, /workflow artifact\. \[View run/);
});

test('renderPrComment flags a partial run that still wrote a report', () => {
	const body = renderPrComment({ state: 'partial', markdown: SUMMARY_MD, baseUrl: 'https://cdn.example/run', runUrl: RUN_URL, headSha: SHA });
	assert.match(body, /^1 major \u00b7/m);
	assert.match(body, /turn cap/);
});

test('renderPrComment says the run failed when the agent never ran', () => {
	// The build broke, so there is no outcome and no report. The "running"
	// comment must still be replaced with something true.
	const body = renderPrComment({ state: '', markdown: null, baseUrl: '', runUrl: RUN_URL, headSha: SHA });
	assert.match(body, /failed before/);
	assert.doesNotMatch(body, /Looking for trouble/);
});

test('renderPrComment explains a missing report per outcome', () => {
	assert.match(renderPrComment({ state: 'partial', markdown: null, baseUrl: '', runUrl: RUN_URL, headSha: SHA }), /turn cap before writing a report/);
	assert.match(renderPrComment({ state: 'no-report', markdown: null, baseUrl: '', runUrl: RUN_URL, headSha: SHA }), /without writing a report/);
});

test('renderPrComment leaves the SHA out rather than print an empty one', () => {
	assert.match(renderPrComment({ state: '', markdown: null, baseUrl: '', runUrl: RUN_URL, headSha: '' }), /^\*\*\u{1F50E} Exploratory testing\*\*$/mu);
	assert.match(renderPrComment({ state: 'running', markdown: null, baseUrl: '', runUrl: RUN_URL, headSha: '' }), /^\*\*\u{1F50E} Exploratory testing\*\*$/mu);
});

test('withPrLine stamps the PR under the meta line, once, and only for a number', () => {
	const report = '# Exploratory test: x\n\n`branch` | `abc1234`\n\n**Result:** fine\n';
	assert.equal(withPrLine(report, 'posit-dev/positron', '16188'),
		'# Exploratory test: x\n\n`branch` | `abc1234`\n\nPR: posit-dev/positron#16188\n\n**Result:** fine\n');
	// A dispatched run has no PR.
	assert.equal(withPrLine(report, 'posit-dev/positron', ''), report);
	assert.equal(withPrLine(report, 'posit-dev/positron', undefined), report);
	assert.equal(withPrLine(report, 'posit-dev/positron', '12; rm'), report);
	// Already stamped, or nowhere to put it.
	const stamped = withPrLine(report, 'posit-dev/positron', '1');
	assert.equal(withPrLine(stamped, 'posit-dev/positron', '1'), stamped);
	assert.equal(withPrLine('# Exploratory test: x\n\n## Findings\n\n`code`\n', 'posit-dev/positron', '1'), '# Exploratory test: x\n\n## Findings\n\n`code`\n');
	assert.equal(withPrLine(null, 'posit-dev/positron', '1'), null);
});

test('isProductPath rejects tests, docs and harness files', () => {
	for (const p of [
		'test/e2e/pages/dataConnections.ts',
		'test/e2e/tests/data-connections/driver-logging.test.ts',
		'src/vs/workbench/contrib/x/test/browser/row.vitest.tsx',
		'extensions/positron-r/src/test/foo.ts',
		'.github/workflows/test-exploratory.yml',
		'.claude/skills/x/SKILL.md',
		'README.md',
		'docs/design/spec.md',
	]) {
		assert.equal(isProductPath(p), false, p);
	}
});

test('isProductPath keeps source, styles and config', () => {
	for (const p of [
		'src/vs/workbench/contrib/x/browser/row.tsx',
		'src/vs/workbench/contrib/x/browser/dialog.css',
		'extensions/positron-r/package.json',
		'src/vs/workbench/contrib/testing/browser/testingView.ts',
	]) {
		assert.equal(isProductPath(p), true, p);
	}
});

test('renderPrComment says a declined run was not run, and why', () => {
	const body = renderPrComment({ state: 'declined', markdown: null, baseUrl: '', runUrl: RUN_URL, headSha: SHA, reason: 'only tests changed' });
	assert.ok(body.startsWith(COMMENT_MARKER));
	assert.match(body, /Not run/);
	assert.match(body, /only tests changed/);
	assert.doesNotMatch(body, /failed before/);
});

test('renderSummaryTarget names the branch and links the PR', () => {
	assert.equal(renderSummaryTarget('fix/x', 'o/r', '12'), 'PR [#12](https://github.com/o/r/pull/12) · `fix/x`\n\n');
});

test('renderSummaryTarget leaves the PR off when there is none', () => {
	assert.equal(renderSummaryTarget('fix/x', 'o/r', ''), '`fix/x`\n\n');
	assert.equal(renderSummaryTarget('fix/x', 'o/r', undefined), '`fix/x`\n\n');
	assert.equal(renderSummaryTarget('', 'o/r', ''), '');
});

test('renderSummaryTarget adds the focus on one line when given', () => {
	assert.equal(renderSummaryTarget('main', 'o/r', '', ' the plots pane\n\nzoom '), '`main`\n\n**Focus:** the plots pane zoom\n\n');
	assert.equal(renderSummaryTarget('main', 'o/r', '', '  \n'), '`main`\n\n');
});

// run.mjs and gate.mjs run only in CI and no test imports them.
test('every script in the action parses', async () => {
	const { spawnSync } = await import('node:child_process');
	const { readdirSync } = await import('node:fs');
	const dir = new URL('.', import.meta.url);
	for (const f of readdirSync(dir).filter(f => f.endsWith('.mjs'))) {
		const r = spawnSync(process.execPath, ['--check', new URL(f, dir).pathname], { encoding: 'utf8' });
		assert.equal(r.status, 0, `${f}: ${r.stderr}`);
	}
});

const VERIFIER = readFileSync(new URL('../../../.claude/skills/exploratory-test/verifier.md', import.meta.url), 'utf8');
const RUN = { workDir: '/tmp/run', repoRoot: '/repo', baseSha: 'aaaa1111', headSha: 'bbbb2222' };

test('buildVerifyPrompt fills verifier.md with the run paths and diff range', () => {
	const prompt = buildVerifyPrompt(VERIFIER, RUN);
	assert.doesNotMatch(prompt, /\{\{/);
	assert.match(prompt, /^You are verifying an exploratory-test report/);
	assert.match(prompt, /Report: `\/tmp\/run\/report\.md`/);
	assert.match(prompt, /`\/tmp\/run\/files\/`/);
	assert.match(prompt, /git -C \/repo diff aaaa1111\.\.\.bbbb2222/);
	// parseVerdicts reads this line from the reply, so the example has to survive.
	assert.match(prompt, /\nVERDICTS: 1=CONFIRMED; 2=FALSE POSITIVE\n/);
});

test('buildVerifyPrompt throws when the template and its values drift apart', () => {
	assert.throws(() => buildVerifyPrompt(`${VERIFIER}\n{{NEW_THING}}`, RUN), /no value for \{\{NEW_THING\}\}/);
	assert.throws(() => buildVerifyPrompt(VERIFIER.replaceAll('{{FILES}}', ''), RUN), /\{\{FILES\}\} not in the template/);
});

test('buildTaskLine targets the diff when no focus is given', () => {
	for (const focus of ['', '  \n ', undefined]) {
		const line = buildTaskLine(focus);
		assert.match(line, /^Read the diff/);
		assert.doesNotMatch(line, /asked you to test/);
	}
});

test('buildTaskLine quotes a multi-line focus and makes it the target', () => {
	const line = buildTaskLine('  the plots pane\n\nwith a dark theme  ');
	assert.match(line, /asked you to test this:\n\n> the plots pane\n>\n> with a dark theme\n\n/);
	assert.match(line, /The diff is context/);
});

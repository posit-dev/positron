/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderReportHtml } from './html.mjs';
import { reportFromJson } from './report-json.mjs';
import { parseReport } from './report-parse.mjs';

// The renders these tests run must not post usage rows.
process.env.EXPLORATORY_TEST_NO_USAGE = '1';

/** One finding, as report.md writes it. */
const MARKDOWN = [
	'# Exploratory test: Save As',
	'',
	'`mi/save-as` | `abc1234`',
	'',
	'**Result:** Save As works. **The session picker keeps the old name.**',
	'**Tested:** Save As from untitled documents, 2 scenarios',
	'',
	'## Findings',
	'',
	'| # | Finding | Severity | Impact | Introduced? | Reproduction | Verified |',
	'|---|---------|----------|--------|-------------|--------------|----------|',
	'| 1 | Session picker shows old name | minor | wrong label | yes | 1/1 | confirmed |',
	'',
	'### Finding 1: Session picker shows old name',
	'',
	'**Feature:** Quarto inline output',
	'',
	'**Repro**',
	'',
	'**Preconditions:**',
	'- Python venv | Python 3.14.6 in the workspace `.venv`',
	'- Inline output on | `"quarto.inlineOutput.enabled": true` in user settings',
	'',
	'1. Run `Interpreter: Select Session`.',
	'2. VERIFY the row reads `Untitled-2.qmd - Python` -> PASS',
	'   Evidence: S13-01.png',
	'3. Press Cmd+Shift+S.',
	'4. VERIFY the row reads `named.qmd - Python` -> FAIL - Finding 1',
	'   Observed: The row reads `named.qmd - Untitled-2.qmd`',
	'   Evidence: S13-02.png',
	'',
	'**Observed:** The row reads `named.qmd - Untitled-2.qmd`.',
	'',
	'**Expected:** The row reads `named.qmd - Python`.',
	'',
	'**Evidence**',
	'',
	'- [shots/S04-01.png](shots/S04-01.png) -- S04: two rows read `Untitled-1.qmd`',
	'- `logs/renderer.log:2010` | Renderer process | 22:02:35 -- "Following Save As"',
	'',
	'**Cause (hypothesis):** `_followSaveAs` moves the URI but not the name.',
	'',
].join('\n');

/** The same finding, as report.json writes it. */
function json() {
	return {
		header: {
			title: 'Exploratory test: Save As',
			branch: 'mi/save-as',
			sha: 'abc1234',
			pr: { repo: 'posit-dev/positron', number: 123 },
			result: 'Save As works. **The session picker keeps the old name.**',
			tested: 'Save As from untitled documents, 2 scenarios',
		},
		findings: [{
			n: 1,
			title: 'Session picker shows old name',
			feature: 'Quarto inline output',
			severity: 'minor',
			reproduced: { n: 1, m: 1 },
			preconditions: [
				{ name: 'Python venv', text: 'Python 3.14.6 in the workspace `.venv`' },
				{ name: 'Inline output on', text: '`"quarto.inlineOutput.enabled": true` in user settings' },
			],
			steps: [
				{ kind: 'action', text: 'Run `Interpreter: Select Session`.' },
				{ kind: 'verify', text: 'the row reads `Untitled-2.qmd - Python`', result: 'pass', shots: ['shots/S13-01.png'] },
				{ kind: 'action', text: 'Press Cmd+Shift+S.' },
				{ kind: 'verify', text: 'the row reads `named.qmd - Python`', result: 'fail', finding: 1, observed: 'The row reads `named.qmd - Untitled-2.qmd`', shots: ['shots/S13-02.png'] },
			],
			observed: 'The row reads `named.qmd - Untitled-2.qmd`.',
			expected: 'The row reads `named.qmd - Python`.',
			evidence: [
				{ kind: 'shot', path: 'shots/S04-01.png', caption: 'S04: two rows read `Untitled-1.qmd`' },
				{ kind: 'log', path: 'logs/renderer.log:2010', process: 'Renderer process', when: '22:02:35', quote: 'Following Save As' },
			],
			cause: '`_followSaveAs` moves the URI but not the name.',
		}],
		scenarios: [
			{ id: 'S01', name: 'Save As from untitled', status: 'fail', result: 'the picker keeps the old name', findings: [1] },
			{ id: 'S02', name: 'Save As on the web', status: 'not-run', reason: 'no web build' },
		],
	};
}

/** The fields both sources fill, for comparing them. */
function shared(f) {
	return {
		title: f.title,
		feature: f.feature,
		severity: f.severity,
		reproduced: f.reproduced,
		observedHtml: f.observedHtml,
		expectedHtml: f.expectedHtml,
		preconditions: f.preconditions,
		preconditionNames: f.preconditionNames,
		steps: f.steps.map(s => ({ kind: s.kind, html: s.html, result: s.result, finding: s.finding, observedHtml: s.observedHtml, evidence: s.evidence.map(e => e.file) })),
		evidence: f.evidence.map(e => ({ kind: e.kind, file: e.file ?? e.path, caption: e.caption ?? e.quote })),
		causeHtml: f.causeHtml,
	};
}

test('a finding from report.json builds the same model as from report.md', () => {
	const fromMd = parseReport(MARKDOWN).findings[0];
	const fromJson = reportFromJson(json()).findings[0];
	assert.deepEqual(shared(fromJson), shared(fromMd));
});

test('the header carries the title, chips, PR link, lead and severity counts', () => {
	const r = reportFromJson(json());
	assert.deepEqual(
		{ title: r.title, chips: r.chips, pr: r.pr, severityCounts: r.severityCounts, findingCount: r.findingCount },
		{ title: 'Save As', chips: ['mi/save-as', 'abc1234'], pr: { number: 123, url: 'https://github.com/posit-dev/positron/pull/123' }, severityCounts: { major: 0, moderate: 0, minor: 1 }, findingCount: 1 },
	);
	assert.match(r.leadHtml, /<strong>The session picker keeps the old name\.<\/strong>/);
});

test('a PR repo that is not owner/name gets no link', () => {
	const j = json();
	j.header.pr.repo = 'evil.example/x/y';
	assert.equal(reportFromJson(j).pr, undefined);
});

test('a log looked for and not found is a "none found" line, not a log body', () => {
	const j = json();
	j.findings[0].steps[0].log = { source: 'logs/renderer.log', body: 'none found' };
	const step = reportFromJson(j).findings[0].steps[0];
	assert.deepEqual({ log: step.log, logBody: step.logBody }, { log: 'none found in logs/renderer.log', logBody: [] });
});

test('a defaults-only precondition is dropped', () => {
	const j = json();
	j.findings[0].preconditions = [{ name: 'Settings', text: 'default settings' }];
	assert.deepEqual(reportFromJson(j).findings[0].preconditions, []);
});

test('tests carry their level, path and a "new file" note', () => {
	const j = json();
	j.findings[0].tests = {
		cases: [{ text: 'the name follows Save As', level: 'unit', path: 'src/a.vitest.ts', isNew: true }],
		related: [{ path: 'src/b.vitest.ts', level: 'unit', note: 'the URI move' }, { level: 'e2e' }],
	};
	const { cases, related } = reportFromJson(j).findings[0].tests;
	assert.deepEqual(
		{ cases: cases.map(c => [c.level, c.path, c.note]), related: related.map(r => [r.level, r.path, r.note]) },
		{ cases: [['Unit', 'src/a.vitest.ts', 'new file']], related: [['Unit', 'src/b.vitest.ts', 'the URI move']] },
	);
});

test('with no ledger, coverage comes from the report\'s scenarios', () => {
	const { coverage } = reportFromJson(json());
	assert.deepEqual(
		{ exercised: coverage.exercised.map(s => [s.id, s.status, s.findings]), notExercised: coverage.notExercised.map(s => [s.id, s.reason]) },
		{ exercised: [['S01', 'fail', [1]]], notExercised: [['S02', 'no web build']] },
	);
});

test('a report.json model renders through the page', () => {
	const html = renderReportHtml('', { report: reportFromJson(json()) });
	assert.match(html, /<h2 class="card-title"[^>]*>Session picker shows old name<\/h2>/);
});

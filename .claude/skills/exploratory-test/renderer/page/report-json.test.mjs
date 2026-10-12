/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderReportHtml } from './html.mjs';
import { reportFromJson } from './report-json.mjs';

// The renders these tests run must not post usage rows.
process.env.EXPLORATORY_TEST_NO_USAGE = '1';

/** One finding, as report.json writes it. */
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

/** The finding fields the page lays out. */
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

test('a finding from report.json builds the model the page lays out', () => {
	assert.deepEqual(shared(reportFromJson(json()).findings[0]), {
		title: 'Session picker shows old name',
		feature: 'Quarto inline output',
		severity: 'minor',
		reproduced: '1/1',
		observedHtml: 'The row reads <code>named.qmd - Untitled-2.qmd</code>.',
		expectedHtml: 'The row reads <code>named.qmd - Python</code>.',
		preconditions: [
			'Python 3.14.6 in the workspace <code>.venv</code>',
			'<code>&quot;quarto.inlineOutput.enabled&quot;: true</code> in user settings',
		],
		preconditionNames: [
			'Python venv',
			'Inline output on',
		],
		steps: [
			{
				kind: 'action',
				html: 'Run <code>Interpreter: Select Session</code>.',
				result: null,
				finding: null,
				observedHtml: '',
				evidence: [],
			},
			{
				kind: 'verify',
				html: 'Verify the row reads <code>Untitled-2.qmd - Python</code>',
				result: 'pass',
				finding: null,
				observedHtml: '',
				evidence: [
					'S13-01.png',
				],
			},
			{
				kind: 'action',
				html: 'Press Cmd+Shift+S.',
				result: null,
				finding: null,
				observedHtml: '',
				evidence: [],
			},
			{
				kind: 'verify',
				html: 'Verify the row reads <code>named.qmd - Python</code>',
				result: 'fail',
				finding: 1,
				observedHtml: 'The row reads <code>named.qmd - Untitled-2.qmd</code>',
				evidence: [
					'S13-02.png',
				],
			},
		],
		evidence: [
			{
				kind: 'shot',
				file: 'S13-01.png',
				caption: 'Verify the row reads Untitled-2.qmd - Python',
			},
			{
				kind: 'shot',
				file: 'S13-02.png',
				caption: 'Verify the row reads named.qmd - Python',
			},
			{
				kind: 'shot',
				file: 'S04-01.png',
				caption: 'S04: two rows read `Untitled-1.qmd`',
			},
			{
				kind: 'log',
				file: 'logs/renderer.log:2010',
				caption: 'Following Save As',
			},
		],
		causeHtml: '<code>_followSaveAs</code> moves the URI but not the name.',
	});
});

test('the header carries the title, chips, PR link, lead and severity counts', () => {
	const r = reportFromJson(json());
	assert.deepEqual(
		{ title: r.title, chips: r.chips, pr: r.pr, severityCounts: r.severityCounts, findingCount: r.findingCount },
		{ title: 'Save As', chips: ['mi/save-as', 'abc1234'], pr: { number: 123, url: 'https://github.com/posit-dev/positron/pull/123' }, severityCounts: { major: 0, moderate: 0, minor: 1 }, findingCount: 1 },
	);
	assert.match(r.leadHtml, /<strong>The session picker keeps the old name\.<\/strong>/);
});

test('findings sort by severity, then by number', () => {
	const j = json();
	const at = (n, severity) => ({ ...j.findings[0], n, severity });
	j.findings = [at(5, 'moderate'), at(2, 'moderate'), at(4, 'minor'), at(1, 'moderate'), at(3, 'major')];
	assert.deepEqual(reportFromJson(j).findings.map(f => f.n), [3, 1, 2, 5, 4]);
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

test('the pipeline\'s cost passes reach the Run tile, with a total only when each has a cost', () => {
	const cost = passes => reportFromJson({ ...json(), cost: { passes } }).cost;
	assert.deepEqual(cost([
		{ label: 'explore', model: 'claude-opus-5-5', costUsd: 3.2, turns: 40, maxTurns: 200, durationMs: 1500000 },
		{ label: 'verify', model: 'sonnet', costUsd: 0.5, turns: 4, durationMs: 120000 },
	]), {
		passes: [
			{ label: 'explore', model: 'Opus 5.5', cost: '$3.20', turns: '40', maxTurns: '200', duration: '25m' },
			{ label: 'verify', model: 'Sonnet', cost: '$0.50', turns: '4', maxTurns: null, duration: '2m' },
		],
		total: '$3.70',
		duration: '27m',
	});
	assert.equal(cost([{ label: 'explore', model: 'opus', costUsd: null, durationMs: 60000 }, { label: 'edit', model: 'sonnet', costUsd: 0.1, durationMs: 1000 }]).total, null);
});

test('a report.json model renders through the page', () => {
	const html = renderReportHtml(reportFromJson(json()));
	assert.match(html, /<h2 class="card-title"[^>]*>Session picker shows old name<\/h2>/);
});

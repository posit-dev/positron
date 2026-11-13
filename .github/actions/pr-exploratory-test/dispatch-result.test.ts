/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectResults, expectedReportUrl, modelsFor, parseJson, renderDispatchSummary, tallyFromResult } from './dispatch-result.ts';

const REPORT = 'https://positron-reports.tail00da2.ts.net/exploratory-report-7-2-opus-ubuntu-x64/';

function dirWith(files) {
	const dir = mkdtempSync(join(tmpdir(), 'dispatch-result-'));
	for (const [name, content] of Object.entries(files)) {
		writeFileSync(join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
	}
	return dir;
}

function collect(dir, overrides = {}) {
	return collectResults({ dir, models: ['opus', 'sonnet'], runConclusion: 'success', timedOutModels: new Set(), jobs: [], runId: '7', runAttempt: '2', ...overrides });
}

test('modelsFor maps resolve\'s model to the matrix list', () => {
	assert.deepEqual([modelsFor('opus'), modelsFor('sonnet'), modelsFor('both'), modelsFor(undefined)],
		[['opus'], ['sonnet'], ['opus', 'sonnet'], ['opus']]);
});

test('parseJson falls back on empty or bad input', () => {
	assert.deepEqual([parseJson('["opus"]', []), parseJson('', []), parseJson('{nope', []), parseJson(undefined)],
		[['opus'], [], [], null]);
});

test('every model gets a state, a missing or mislabeled result file is failed', () => {
	const dir = dirWith({
		'explore-result-opus.json': { model: 'opus', outcome: 'complete', outdated: false, scan: 'passed' },
		'explore-report-url-opus.json': { model: 'opus', reportUrl: REPORT },
		'explore-result-sonnet.json': { model: 'opus', outcome: 'complete', outdated: false, scan: 'passed' },
	});
	assert.deepEqual(collect(dir), {
		results: { opus: { state: 'complete', reportUrl: REPORT }, sonnet: { state: 'failed', reportUrl: '' } },
		scanUrls: {},
		tallies: {},
	});
});

test('an empty or missing folder still gives every model a state', () => {
	assert.deepEqual(collect('').results, { opus: { state: 'failed', reportUrl: '' }, sonnet: { state: 'failed', reportUrl: '' } });
	assert.deepEqual(collect(dirWith({ 'explore-result-opus.json': '{not json' })).results.opus, { state: 'failed', reportUrl: '' });
});

test('a failed scan links its scan job', () => {
	const dir = dirWith({ 'explore-result-sonnet.json': { model: 'sonnet', scan: 'failed' } });
	const jobs = [{ name: 'scan (opus)', html_url: 'https://x/opus' }, { name: 'scan (sonnet)', html_url: 'https://x/sonnet' }];
	assert.deepEqual(collect(dir, { models: ['sonnet'], jobs }), {
		results: { sonnet: { state: 'scan-failed', reportUrl: '' } },
		scanUrls: { sonnet: 'https://x/sonnet' },
		tallies: {},
	});
});

test('a report URL other than the one this run publishes to is dropped', () => {
	const urls = [
		'javascript:alert(1)',
		'https://evil.example.com/exploratory-report-7-2-opus-ubuntu-x64/',
		'https://positron-reports.tail00da2.ts.net/exploratory-report-6-1-opus-ubuntu-x64/',
		`${REPORT}../other/`,
	];
	const states = urls.map(reportUrl => collect(dirWith({
		'explore-result-opus.json': { model: 'opus', outcome: 'partial', outdated: false, scan: 'passed' },
		'explore-report-url-opus.json': { model: 'opus', reportUrl },
	}), { models: ['opus'] }).results.opus);
	assert.deepEqual(states, urls.map(() => ({ state: 'partial', reportUrl: '' })));
});

test('expectedReportUrl needs a numeric run id and attempt', () => {
	assert.deepEqual([
		expectedReportUrl('7', '2', 'sonnet'),
		expectedReportUrl('', '2', 'opus'),
		expectedReportUrl('7', undefined, 'opus'),
		expectedReportUrl('7/../x', '1', 'opus'),
	], ['https://positron-reports.tail00da2.ts.net/exploratory-report-7-2-sonnet-ubuntu-x64/', '', '', '']);
});

test('timed-out models and a cancelled run override the result files', () => {
	const dir = dirWith({ 'explore-result-opus.json': { model: 'opus', outcome: 'complete', outdated: false, scan: 'passed' } });
	assert.equal(collect(dir, { models: ['opus'], timedOutModels: new Set(['opus']) }).results.opus.state, 'job-timeout');
	assert.equal(collect(dir, { models: ['opus'], runConclusion: 'cancelled' }).results.opus.state, 'cancelled');
});

test('a result file\'s counts become the tally, bad counts none', () => {
	assert.equal(tallyFromResult({ findings: 2, severity: { major: 0, moderate: 1, minor: 1 } }), '1 moderate \u00b7 1 minor');
	assert.equal(tallyFromResult({ findings: 0, severity: { major: 0, moderate: 0, minor: 0 } }), 'No findings');
	assert.equal(tallyFromResult({ findings: 2, severity: { major: 0, moderate: '1', minor: 1 } }), '');
	assert.equal(tallyFromResult({ findings: -1, severity: { major: 0, moderate: 0, minor: 0 } }), '');
	assert.equal(tallyFromResult({ findings: 0, severity: { major: 5, moderate: 0, minor: 0 } }), '');
	assert.equal(tallyFromResult({ findings: 3, severity: { major: 0, moderate: 0, minor: 1 } }), '1 minor');
	assert.equal(tallyFromResult({ model: 'opus', outcome: 'complete' }), '');
});

test('collectResults carries the tally of each result file with counts', () => {
	const dir = dirWith({
		'explore-result-opus.json': { model: 'opus', outcome: 'complete', outdated: false, scan: 'passed', findings: 1, severity: { major: 1, moderate: 0, minor: 0 } },
	});
	assert.deepEqual(collect(dir).tallies, { opus: '1 major' });
});

test('the summary matches the builds run\'s: tally, then the report link', () => {
	assert.equal(renderDispatchSummary({ results: { opus: { state: 'complete', reportUrl: REPORT } }, tallies: { opus: '1 moderate \u00b7 1 minor' } }),
		`\n**1 moderate \u00b7 1 minor**\n\n\u{1F50D} [Exploratory Test Report](${REPORT}index.html)\n`);
});

test('the summary names the outcome of a run that did not complete, and each model of two', () => {
	const summary = renderDispatchSummary({
		results: { opus: { state: 'timed-out', reportUrl: REPORT }, sonnet: { state: 'scan-failed', reportUrl: '' } },
		scanUrls: { sonnet: 'https://x/sonnet' },
		tallies: { opus: '1 minor' },
	});
	assert.match(summary, /### opus\n\n\*\*Stopped at the time limit: 1 minor\*\*\n\n.*Exploratory Test Report/);
	assert.match(summary, /### sonnet\n\n\*\*Secret scan failed\*\*\n\n\[Scan job\]\(https:\/\/x\/sonnet\)/);
	assert.equal(renderDispatchSummary({ results: { opus: { state: 'complete', reportUrl: REPORT } } }).split('\n')[1], '**Complete**');
});

test('the summary shows no tally without a report, and never echoes an unknown outcome', () => {
	const summary = renderDispatchSummary({
		results: { opus: { state: 'outdated', reportUrl: '' }, sonnet: { state: '[x](https://evil.example)', reportUrl: REPORT } },
		tallies: { opus: '2 major', sonnet: '1 minor' },
	});
	assert.match(summary, /### opus\n\n\*\*Branch predates the helper update\*\*\n/);
	assert.doesNotMatch(summary, /2 major|evil/);
	assert.match(summary, /\*\*Failed: 1 minor\*\*/);
	assert.match(renderDispatchSummary({ results: { opus: { state: 'complete', reportUrl: '' } }, tallies: { opus: '1 minor' } }),
		/^\n\*\*Complete\*\*\n\nThe report was not published/);
	assert.match(renderDispatchSummary({ results: { opus: { state: 'constructor', reportUrl: '' } } }), /\*\*Failed\*\*/);
});

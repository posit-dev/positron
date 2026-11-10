/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectResults, modelsFor, parseJson } from './dispatch-result.mjs';

const REPORT = 'https://reports.example.com/exploratory-report-1-1-opus-ubuntu-x64/';

function dirWith(files) {
	const dir = mkdtempSync(join(tmpdir(), 'dispatch-result-'));
	for (const [name, content] of Object.entries(files)) {
		writeFileSync(join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
	}
	return dir;
}

function collect(dir, overrides = {}) {
	return collectResults({ dir, models: ['opus', 'sonnet'], runConclusion: 'success', timedOutModels: new Set(), jobs: [], ...overrides });
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
	});
});

test('a report URL that is not https is dropped', () => {
	const dir = dirWith({
		'explore-result-opus.json': { model: 'opus', outcome: 'partial', outdated: false, scan: 'passed' },
		'explore-report-url-opus.json': { model: 'opus', reportUrl: 'javascript:alert(1)' },
	});
	assert.deepEqual(collect(dir, { models: ['opus'] }).results.opus, { state: 'partial', reportUrl: '' });
});

test('timed-out models and a cancelled run override the result files', () => {
	const dir = dirWith({ 'explore-result-opus.json': { model: 'opus', outcome: 'complete', outdated: false, scan: 'passed' } });
	assert.equal(collect(dir, { models: ['opus'], timedOutModels: new Set(['opus']) }).results.opus.state, 'job-timeout');
	assert.equal(collect(dir, { models: ['opus'], runConclusion: 'cancelled' }).results.opus.state, 'cancelled');
});

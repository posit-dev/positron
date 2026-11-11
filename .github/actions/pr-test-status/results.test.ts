/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseCache, parsePlaywright, parseVitest, sanitizeName } from './results.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('sanitizeName', () => {
	assert.strictEqual(sanitizeName('a`b\nc](http://x)'), 'abc](http://x)');
	assert.strictEqual(sanitizeName('x'.repeat(500)).length, 150);
	assert.strictEqual(sanitizeName(42), '');
});

test('parsePlaywright reads the fixture', () => {
	const r = parsePlaywright(fixture('playwright-results.json'));
	assert.deepStrictEqual(r, {
		kind: 'playwright',
		passed: 2,
		failed: 1,
		skipped: 1,
		flaky: 1,
		expectedFailures: 0,
		files: null,
		failures: [{
			file: 'tests/console/console-input.test.ts',
			title: 'Console Input > Python - Can get input string via console',
			shard: null,
		}],
		flakyTests: [{
			file: 'tests/notebook/notebook-create.test.ts',
			title: 'Notebooks > R Notebooks > R - Verify code cell execution and markdown formatting in notebook',
			shard: 2,
		}],
	});
});

test('parsePlaywright returns null on bad input', () => {
	assert.deepStrictEqual(['', '{', '[]', 'null', '{"stats":{}}'].map(parsePlaywright), [null, null, null, null, null]);
});

test('parseVitest reads the fixture', () => {
	const r = parseVitest(fixture('vitest-results.json'));
	assert.deepStrictEqual(r, {
		kind: 'vitest',
		passed: 1,
		failed: 1,
		skipped: 1,
		flaky: 0,
		expectedFailures: 0,
		files: { passed: 2, failed: 1, total: 3 },
		failures: [{
			file: 'src/vs/workbench/contrib/positronPlots/test/browser/plotUtils.vitest.ts',
			title: 'isNavigableSourceUri > is not navigable for notebook cell URIs',
			shard: null,
		}],
		flakyTests: [],
	});
});

test('parseVitest returns null on bad input', () => {
	assert.deepStrictEqual(['', '{', '[]', '"x"', '{"testResults":5}'].map(parseVitest), [null, null, null, null, null]);
});

test('counts that are not integers become 0', () => {
	const r = parseVitest(JSON.stringify({
		numPassedTests: -3, numFailedTests: 1.5, numPendingTests: '7', numPassedTestSuites: null,
		numFailedTestSuites: 1e999, numTotalTestSuites: 4, testResults: [],
	}));
	assert.deepStrictEqual(r?.files, { passed: 0, failed: 0, total: 4 });
	assert.deepStrictEqual([r?.passed, r?.failed, r?.skipped], [0, 0, 0]);
});

test('parseCache keeps only known names with boolean hit', () => {
	const raw = JSON.stringify([
		{ name: 'npm-core', hit: true },
		{ name: 'builtins', hit: false },
		{ name: 'evil', hit: true },
		{ name: 'playwright', hit: 'yes' },
		{ name: 'npm-ext-stable', hit: true, extra: 'x' },
	]);
	assert.deepStrictEqual(parseCache(raw), [
		{ name: 'npm-core', hit: true },
		{ name: 'builtins', hit: false },
		{ name: 'npm-ext-stable', hit: true },
	]);
	assert.strictEqual(parseCache('{'), null);
	assert.strictEqual(parseCache('{}'), null);
});

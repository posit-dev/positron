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
		passed: 2,
		failed: 1,
		failures: [{
			file: 'tests/console/console-input.test.ts',
			title: 'Console Input > Python - Can get input string via console',
		}],
		flakyTests: [{
			file: 'tests/notebook/notebook-create.test.ts',
			title: 'Notebooks > R Notebooks > R - Verify code cell execution and markdown formatting in notebook',
		}],
	});
});

test('parsePlaywright returns null on bad input', () => {
	assert.deepStrictEqual(['', '{', '[]', 'null', '{"stats":{}}'].map(parsePlaywright), [null, null, null, null, null]);
});

test('parseVitest reads the fixture', () => {
	const r = parseVitest(fixture('vitest-results.json'));
	assert.deepStrictEqual(r, {
		passed: 1,
		failed: 1,
		failures: [{
			file: 'src/vs/workbench/contrib/positronPlots/test/browser/plotUtils.vitest.ts',
			title: 'isNavigableSourceUri > is not navigable for notebook cell URIs',
		}],
		flakyTests: [],
	});
});

test('parseVitest returns null on bad input', () => {
	assert.deepStrictEqual(['', '{', '[]', '"x"', '{"testResults":5}'].map(parseVitest), [null, null, null, null, null]);
});

test('counts that are not integers become 0', () => {
	const r = parseVitest(JSON.stringify({
		numPassedTests: -3, numFailedTests: 1.5, testResults: [],
	}));
	assert.deepStrictEqual([r?.passed, r?.failed], [0, 0]);
	assert.strictEqual(parseVitest(JSON.stringify({ numPassedTests: 4, numFailedTests: 1e999, testResults: [] }))?.passed, 4);
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

test('sanitizeName strips control characters and cuts on code points', () => {
	assert.strictEqual(sanitizeName('a\rb\u000bc\u2028d\u2029e\u0085f\u007fg'), 'abcdefg');
	const cut = sanitizeName('x'.repeat(149) + '\u{1F600}\u{1F600}');
	assert.deepStrictEqual([Array.from(cut).length, cut.endsWith('\u{1F600}'), /[\ud800-\udfff]/.test(cut.slice(0, -2))], [150, true, false]);
});

test('deeply nested input does not throw', () => {
	const depth = 50000;
	const pw = '{"stats":{},"suites":[' + '{"title":"s","suites":['.repeat(depth) + ']}'.repeat(depth) + ']}';
	const vt = '{"testResults":[{"name":"f","assertionResults":[{"status":"failed","title":"t","ancestorTitles":'
		+ '['.repeat(depth) + ']'.repeat(depth) + '}]}]}';
	assert.doesNotThrow(() => [parsePlaywright(pw), parseVitest(vt)]);
	const shallow = '{"stats":{},"suites":[' + '{"title":"s","suites":['.repeat(200) + ']}'.repeat(200) + ']}';
	assert.deepStrictEqual(parsePlaywright(shallow)?.failures, []);
});

test('hostile members are ignored', () => {
	const pw = parsePlaywright('{"__proto__":{"x":1},"stats":{"__proto__":{"expected":9}},"suites":[1,null,[],"s",'
		+ '{"title":"s","specs":[3,{"title":"t","file":"f","tests":[7,{"status":"unexpected","results":[null,5]}]}]}]}');
	assert.deepStrictEqual([pw?.passed, pw?.failures], [0, [{ file: 'f', title: 's > t' }]]);
	const vt = parseVitest('{"testResults":[1,null,{"name":"a/src/b.ts","assertionResults":[2,{"status":"failed","title":"t","ancestorTitles":[1,"d",{}]}]}]}');
	assert.deepStrictEqual(vt?.failures, [{ file: 'src/b.ts', title: 'd > t' }]);
});

test('parseVitest names a file that failed to load', () => {
	const r = parseVitest(JSON.stringify({
		numFailedTestSuites: 1,
		testResults: [{ name: '/home/runner/work/positron/positron/src/vs/x/y.vitest.ts', status: 'failed', assertionResults: [] }],
	}));
	assert.deepStrictEqual(r?.failures, [{ file: 'src/vs/x/y.vitest.ts', title: 'src/vs/x/y.vitest.ts' }]);
});

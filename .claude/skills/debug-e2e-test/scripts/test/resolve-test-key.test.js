// Unit tests for resolve-test-key.js pure helpers. No network, no Playwright run.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
	flattenListJson, classifyInput, keyFromDashboardUrl, matchEntries, buildKey,
} from '../resolve-test-key.js';

const REPO = '/repo';

/** Minimal shape of `playwright test --list --reporter=json`. */
const listJson = {
	config: { rootDir: '/repo/test/e2e' },
	suites: [{
		title: 'tests/console/console-history.test.ts',
		specs: [],
		suites: [{
			title: 'Console History',
			specs: [
				{ title: 'Python - first history', file: 'tests/console/console-history.test.ts', line: 20 },
				{ title: 'R - first history', file: 'tests/console/console-history.test.ts', line: 35 },
			],
			suites: [],
		}],
	}, {
		title: 'tests/plots/plots.test.ts',
		specs: [{ title: 'top-level test', file: 'tests/plots/plots.test.ts', line: 8 }],
		suites: [{
			title: 'Plots',
			specs: [],
			suites: [{
				title: 'Nested',
				specs: [{ title: 'R - first history', file: 'tests/plots/plots.test.ts', line: 12 }],
				suites: [],
			}],
		}],
	}],
};

const entries = flattenListJson(listJson, REPO);

describe('flattenListJson', () => {
	test('drops the file-level suite, keeps the describe hierarchy, and repo-relativizes paths', () => {
		assert.deepEqual(entries, [
			{
				testKey: 'Console History > Python - first history|||test/e2e/tests/console/console-history.test.ts',
				testName: 'Console History > Python - first history',
				specPath: 'test/e2e/tests/console/console-history.test.ts',
				line: 20,
				leaf: 'Python - first history',
			},
			{
				testKey: 'Console History > R - first history|||test/e2e/tests/console/console-history.test.ts',
				testName: 'Console History > R - first history',
				specPath: 'test/e2e/tests/console/console-history.test.ts',
				line: 35,
				leaf: 'R - first history',
			},
			{
				testKey: 'top-level test|||test/e2e/tests/plots/plots.test.ts',
				testName: 'top-level test',
				specPath: 'test/e2e/tests/plots/plots.test.ts',
				line: 8,
				leaf: 'top-level test',
			},
			{
				testKey: 'Plots > Nested > R - first history|||test/e2e/tests/plots/plots.test.ts',
				testName: 'Plots > Nested > R - first history',
				specPath: 'test/e2e/tests/plots/plots.test.ts',
				line: 12,
				leaf: 'R - first history',
			},
		]);
	});

	test('dedupes the same spec listed once per project', () => {
		const twoProjects = { ...listJson, suites: [...listJson.suites, ...listJson.suites] };
		assert.equal(flattenListJson(twoProjects, REPO).length, entries.length);
	});
});

describe('classifyInput', () => {
	test('detects every accepted shape', () => {
		assert.deepEqual([
			classifyInput('Console History > R - first history|||test/e2e/x.test.ts').mode,
			classifyInput('https://c.posit.it/?test=A%7C%7C%7Cb.test.ts').mode,
			classifyInput('https://c.posit.it/e2e-test-insights/').mode,
			classifyInput('test/e2e/tests/console/console-history.test.ts').mode,
			classifyInput('test/e2e/tests/console/console-history.test.ts:35').mode,
			classifyInput('Cmd+Up engages prefix-match').mode,
			classifyInput('   ').mode,
		], [
			'exact-key', 'dashboard-url', 'unusable-url',
			'spec-path', 'spec-line', 'title-search', 'empty',
		]);
	});

	test('strips wrapping quotes left over from a copy-paste', () => {
		assert.equal(classifyInput('"tests/foo.test.ts"').file, 'tests/foo.test.ts');
	});

	test('a title containing a spec name is still a title search', () => {
		assert.equal(classifyInput('fails in console-history.test.ts').mode, 'title-search');
	});
});

describe('keyFromDashboardUrl', () => {
	test('decodes the test param and rejects a URL without one', () => {
		assert.deepEqual([
			keyFromDashboardUrl('https://c/?tab=test_health&test=Suite%20%3E%20t%7C%7C%7Ctest%2Fe2e%2Fa.test.ts'),
			keyFromDashboardUrl('https://c/?tab=test_health'),
			keyFromDashboardUrl('not a url'),
		], ['Suite > t|||test/e2e/a.test.ts', null, null]);
	});
});

describe('matchEntries', () => {
	const match = input => matchEntries(entries, classifyInput(input));

	test('a unique leaf title resolves to the full hierarchical key', () => {
		assert.equal(match('Python - first history').resolved.testKey,
			'Console History > Python - first history|||test/e2e/tests/console/console-history.test.ts');
	});

	test('a leaf title shared across specs is ambiguous, not a wrong guess', () => {
		const { resolved, candidates } = match('R - first history');
		assert.equal(resolved, null);
		assert.deepEqual(candidates.map(c => c.specPath), [
			'test/e2e/tests/console/console-history.test.ts',
			'test/e2e/tests/plots/plots.test.ts',
		]);
	});

	test('an exact full title wins over looser substring hits', () => {
		assert.equal(match('Plots > Nested > R - first history').resolved.line, 12);
	});

	test('substring and case-insensitive matching both work', () => {
		assert.equal(match('PYTHON - FIRST').resolved.line, 20);
	});

	test('a spec path returns every test in the file as candidates', () => {
		assert.equal(match('console-history.test.ts').candidates.length, 2);
	});

	test('a bare basename matches the same file as the full path', () => {
		assert.deepEqual(
			match('plots.test.ts').candidates.map(c => c.line),
			match('test/e2e/tests/plots/plots.test.ts').candidates.map(c => c.line),
		);
	});

	test('spec:line picks the test declared at or nearest above the line', () => {
		assert.deepEqual([
			match('console-history.test.ts:35').resolved.line,
			match('console-history.test.ts:41').resolved.line,
			match('console-history.test.ts:22').resolved.line,
		], [35, 35, 20]);
	});

	test('spec:line above the first test falls back to the whole file', () => {
		assert.equal(match('console-history.test.ts:3').resolved, null);
	});

	test('a key absent from the working tree passes through flagged, not blocked', () => {
		const key = buildKey('Gone > removed', 'test/e2e/tests/gone.test.ts');
		const { resolved, inWorkingTree } = matchEntries(entries, classifyInput(key));
		assert.deepEqual([resolved.testKey, inWorkingTree], [key, false]);
	});

	test('a dashboard URL for a live test resolves against the tree', () => {
		const url = `https://c/?test=${encodeURIComponent('Plots > Nested > R - first history|||test/e2e/tests/plots/plots.test.ts')}`;
		assert.equal(matchEntries(entries, classifyInput(url)).resolved.line, 12);
	});

	test('no match returns neither a resolution nor candidates', () => {
		assert.deepEqual(match('nothing like this exists'), { resolved: null, candidates: [] });
	});
});

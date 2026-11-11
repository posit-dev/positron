/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/** A failed or flaky test. Fields are already sanitized. */
export type FailedTest = { file: string; title: string; shard: number | null };

/** Parsed counts and failing tests for one test lane. */
export type Results = {
	kind: 'playwright' | 'vitest';
	passed: number;
	failed: number;
	skipped: number;
	flaky: number;
	expectedFailures: number;
	files: { passed: number; failed: number; total: number } | null;
	failures: FailedTest[];
	flakyTests: FailedTest[];
};

/** Whether one cache was restored in the test run. */
export type CacheEntry = {
	name: 'npm-core' | 'npm-ext-volatile' | 'npm-ext-stable' | 'builtins' | 'playwright';
	hit: boolean;
};

type Obj = Record<string, unknown>;

const CACHE_NAMES: readonly string[] = ['npm-core', 'npm-ext-volatile', 'npm-ext-stable', 'builtins', 'playwright'];

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => Array.isArray(v) ? v : [];

/** Results files come from PR code: anything but a non-negative integer is 0. */
function count(v: unknown): number {
	return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : 0;
}

/** Makes an untrusted test name safe to show in a code span: no backticks or line breaks, at most 150 chars. */
export function sanitizeName(raw: unknown): string {
	return typeof raw === 'string' ? raw.replace(/[`\r\n]/g, '').slice(0, 150) : '';
}

function parseJson(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
}

function walkPlaywright(suite: Obj, parents: string[], out: { failures: FailedTest[]; flakyTests: FailedTest[] }): void {
	const title = typeof suite.title === 'string' ? suite.title : '';
	// The file-level suite is titled with the file path, which is already in `file`.
	const here = title && title !== suite.file ? [...parents, title] : parents;
	for (const spec of arr(suite.specs)) {
		if (!isObj(spec)) {
			continue;
		}
		for (const test of arr(spec.tests)) {
			if (!isObj(test) || (test.status !== 'unexpected' && test.status !== 'flaky')) {
				continue;
			}
			const shards = arr(test.results)
				.map(r => isObj(r) ? r.shardIndex : undefined)
				.filter((s): s is number => typeof s === 'number' && Number.isSafeInteger(s) && s >= 0);
			const entry: FailedTest = {
				file: sanitizeName(spec.file),
				title: sanitizeName([...here, spec.title].join(' > ')),
				shard: shards.length > 0 ? shards[0] : null,
			};
			(test.status === 'unexpected' ? out.failures : out.flakyTests).push(entry);
		}
	}
	for (const child of arr(suite.suites)) {
		if (isObj(child)) {
			walkPlaywright(child, here, out);
		}
	}
}

/** Parses a merged Playwright JSON report, or returns null if it is not one. */
export function parsePlaywright(raw: string): Results | null {
	const data = parseJson(raw);
	if (!isObj(data) || !Array.isArray(data.suites) || !isObj(data.stats)) {
		return null;
	}
	const out = { failures: [] as FailedTest[], flakyTests: [] as FailedTest[] };
	for (const suite of data.suites) {
		if (isObj(suite)) {
			walkPlaywright(suite, [], out);
		}
	}
	const stats = data.stats;
	return {
		kind: 'playwright',
		passed: count(stats.expected),
		failed: count(stats.unexpected),
		skipped: count(stats.skipped),
		flaky: count(stats.flaky),
		expectedFailures: 0,
		files: null,
		...out,
	};
}

/** Cuts a path down to start at its first src, extensions, or test directory (later ones are nested test folders). */
function relativeFile(name: unknown): string {
	if (typeof name !== 'string') {
		return '';
	}
	const found = ['/src/', '/extensions/', '/test/'].map(s => name.indexOf(s)).filter(i => i >= 0);
	const at = found.length > 0 ? Math.min(...found) : -1;
	return sanitizeName(at >= 0 ? name.slice(at + 1) : name);
}

/** Parses a Vitest JSON reporter file, or returns null if it is not one. */
export function parseVitest(raw: string): Results | null {
	const data = parseJson(raw);
	if (!isObj(data) || !Array.isArray(data.testResults)) {
		return null;
	}
	const failures: FailedTest[] = [];
	for (const result of data.testResults) {
		if (!isObj(result)) {
			continue;
		}
		for (const a of arr(result.assertionResults)) {
			if (isObj(a) && a.status === 'failed') {
				failures.push({
					file: relativeFile(result.name),
					title: sanitizeName([...arr(a.ancestorTitles), a.title].join(' > ')),
					shard: null,
				});
			}
		}
	}
	return {
		kind: 'vitest',
		passed: count(data.numPassedTests),
		failed: count(data.numFailedTests),
		skipped: count(data.numPendingTests),
		flaky: 0,
		expectedFailures: 0,
		files: {
			passed: count(data.numPassedTestSuites),
			failed: count(data.numFailedTestSuites),
			total: count(data.numTotalTestSuites),
		},
		failures,
		flakyTests: [],
	};
}

/** Parses the cache-hit list, keeping only known names with a boolean `hit`. */
export function parseCache(raw: string): CacheEntry[] | null {
	const data = parseJson(raw);
	if (!Array.isArray(data)) {
		return null;
	}
	const entries: CacheEntry[] = [];
	for (const e of data) {
		if (isObj(e) && typeof e.name === 'string' && CACHE_NAMES.includes(e.name) && typeof e.hit === 'boolean') {
			entries.push({ name: e.name as CacheEntry['name'], hit: e.hit });
		}
	}
	return entries;
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePattern, mergeHistory, classifyVerdict } from '../triage-history.js';

const mkTest = (runs, patterns) => ({ history: { total_runs: runs }, failure_patterns: patterns });
const occ = (sha, os = 'ubuntu', browser = 'electron') => ({ sha, os, browser, outcome: 'flaky', report_url: `https://x/${sha}/index.html` });

test('normalizePattern collapses whitespace, lowercases, and truncates', () => {
	assert.equal(normalizePattern('  Error:  Foo\n\nBar  '), 'error: foo bar');
	assert.equal(normalizePattern('X'.repeat(300)).length, 160);
});

test('mergeHistory matches patterns across branches by text, not position', () => {
	const current = mkTest(10, [{ pattern: 'toBeVisible timeout', count: 2, occurrences: [occ('c1')] }]);
	const main = mkTest(300, [
		{ pattern: 'locator.click timeout', count: 1, occurrences: [occ('m1', 'win')] },
		{ pattern: 'toBeVisible timeout', count: 5, occurrences: [occ('m2')] },
	]);
	const { patterns, totalRuns } = mergeHistory(current, main, 'feature/x', 1);

	assert.equal(totalRuns, 310);
	// count-descending: shared 'toBeVisible' (2+5=7) first, then 'locator.click' (1).
	assert.equal(patterns[0].failure, 'toBeVisible timeout');
	assert.equal(patterns[0].count, 7);
	assert.equal(patterns[0].seenOn, 'both');
	assert.equal(patterns[1].seenOn, 'main only');
	assert.deepEqual(patterns[0].id + patterns[1].id, 'AB');
});

test('mergeHistory prefers a current-branch representative occurrence and keeps only N', () => {
	const current = mkTest(10, [{ pattern: 'p', count: 1, occurrences: [occ('cur')] }]);
	const main = mkTest(10, [{ pattern: 'p', count: 3, occurrences: [occ('main1'), occ('main2')] }]);
	const { patterns } = mergeHistory(current, main, 'feature/x', 1);
	assert.equal(patterns[0].representativeOccurrence.sha, 'cur');
	assert.equal(patterns[0].keptOccurrences.length, 1);
});

test('classifyVerdict: both branches zero-runs is a key mismatch, not clean', () => {
	const v = classifyVerdict({ currentBranch: 'feature/x', currentRuns: 0, mainRuns: 0, patternCount: 0, queriedCurrent: true });
	assert.equal(v.verdict, 'zero-runs-both');
	assert.equal(v.stop, true);
});

test('classifyVerdict: new branch with zero runs but live main history proceeds', () => {
	const v = classifyVerdict({ currentBranch: 'feature/x', currentRuns: 0, mainRuns: 300, patternCount: 2, queriedCurrent: true });
	assert.equal(v.verdict, 'ok-current-branch-new');
	assert.equal(v.stop, false);
});

test('classifyVerdict: nonzero runs and no patterns is a clean bill', () => {
	const v = classifyVerdict({ currentBranch: 'main', currentRuns: null, mainRuns: 300, patternCount: 0, queriedCurrent: false });
	assert.equal(v.verdict, 'clean');
	assert.equal(v.stop, true);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePattern, mergeHistory, classifyVerdict, patternLabel, scopedRunsForEnvironments } from '../triage-history.js';

const mkTest = (runs, patterns, environmentBreakdown) => ({ history: { total_runs: runs }, failure_patterns: patterns, environment_breakdown: environmentBreakdown });
const occ = (sha, os = 'ubuntu', browser = 'electron') => ({ sha, os, browser, outcome: 'flaky', report_url: `https://x/${sha}/index.html` });
const env = (os, browser, total_runs) => ({ os, browser, total_runs });

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

test('mergeHistory scopes each branch rate to the environments the pattern occurred in, not blended totals', () => {
	// Regression: a pattern confined to one environment on one branch must not be
	// diluted by dividing its count by the combined total_runs of both branches
	// across all environments (that understated a 100%-in-environment failure as 0.8%).
	const current = mkTest(11, [
		{ pattern: 'locator.click timeout', count: 4, occurrences: [occ('c1', 'ubuntu', 'chromium')] },
	], [
		env('ubuntu', 'chromium', 4), env('ubuntu', 'electron', 3), env('win', 'electron', 4),
	]);
	const main = mkTest(480, [
		{ pattern: 'locator.click timeout', count: 3, occurrences: [occ('m1', 'ubuntu', 'chromium')] },
	], [
		env('ubuntu', 'chromium', 157), env('ubuntu', 'electron', 142), env('win', 'electron', 133),
	]);
	const { patterns } = mergeHistory(current, main, 'feature/x', 1);

	assert.equal(patterns[0].environments.length, 1);
	assert.equal(patterns[0].environments[0], 'ubuntu/chromium');
	const byBranch = Object.fromEntries(patterns[0].rates.map(r => [r.branch, r]));
	assert.deepEqual(byBranch['feature/x'], { branch: 'feature/x', count: 4, environmentRuns: 4, ratePercent: 100 });
	assert.deepEqual(byBranch.main, { branch: 'main', count: 3, environmentRuns: 157, ratePercent: 1.9 });
});

test('scopedRunsForEnvironments sums only matching os/browser entries, null when no match or no breakdown', () => {
	const breakdown = [env('ubuntu', 'chromium', 10), env('win', 'electron', 5)];
	assert.equal(scopedRunsForEnvironments(breakdown, ['ubuntu/chromium']), 10);
	assert.equal(scopedRunsForEnvironments(breakdown, ['ubuntu/chromium', 'win/electron']), 15);
	assert.equal(scopedRunsForEnvironments(breakdown, ['mac/electron']), null);
	assert.equal(scopedRunsForEnvironments(null, ['ubuntu/chromium']), null);
	assert.equal(scopedRunsForEnvironments(breakdown, []), null);
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

test('classifyVerdict: triaging on main with zero runs is a key mismatch, not clean', () => {
	// queriedCurrent=false + mainRuns=0 must not fall through to the clean branch.
	const v = classifyVerdict({ currentBranch: 'main', currentRuns: null, mainRuns: 0, patternCount: 0, queriedCurrent: false });
	assert.equal(v.verdict, 'zero-runs-both');
	assert.equal(v.stop, true);
});

test('patternLabel: A..Z then AA, AB for 27+ patterns (no non-letter overflow)', () => {
	assert.deepEqual([0, 25, 26, 27].map(patternLabel), ['A', 'Z', 'AA', 'AB']);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePattern, mergeHistory, classifyVerdict, patternLabel, scopedRunsForEnvironments, resolveLastSeen, runApiPath, deriveFixHeld, daysSince } from '../triage-history.js';

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

test('resolveLastSeen picks the newest occurrence by date, not API order', () => {
	const now = Date.parse('2026-07-29T00:00:00Z');
	const dates = { old: '2026-07-20T10:00:00Z', new: '2026-07-28T10:00:00Z' };
	// Deliberately out of order: the newest must win on date, not position.
	const got = resolveLastSeen([occ('old'), occ('new')], o => dates[o.sha], now);
	assert.deepEqual(got, { date: '2026-07-28', daysAgo: 1, sha: 'new' });
});

test('resolveLastSeen falls back to the first occurrence identity when no date resolves', () => {
	// A shallow clone with no gh fallback must still name the latest occurrence
	// (API order is most-recent-first) rather than dropping lastSeen entirely.
	const got = resolveLastSeen([occ('a'), occ('b')], () => null);
	assert.deepEqual(got, { date: null, daysAgo: null, sha: 'a' });
	assert.equal(resolveLastSeen([], () => null), null);
});

test('mergeHistory surfaces lastSeen per pattern so a stale burst is distinguishable from a live drip', () => {
	const now = Date.parse('2026-07-29T00:00:00Z');
	const dates = { stale: '2026-07-24T10:00:00Z', live: '2026-07-29T10:00:00Z' };
	const main = mkTest(100, [
		{ pattern: 'acute burst, already fixed', count: 10, occurrences: [occ('stale')] },
		{ pattern: 'ongoing drip', count: 3, occurrences: [occ('live')] },
	]);
	const { patterns } = mergeHistory(null, main, 'main', 1, o => dates[o.sha]);
	// Sort stays count-descending; recency is surfaced, not used to reorder.
	assert.deepEqual(
		patterns.map(p => [p.failure, p.lastSeen.date]),
		[['acute burst, already fixed', '2026-07-24'], ['ongoing drip', '2026-07-29']],
	);
	assert.equal(mergeHistory(null, main, 'main', 1, o => dates[o.sha]).patterns[0].lastSeen.daysAgo > 0, true);
	assert.equal(resolveLastSeen([occ('live')], o => dates[o.sha], now).daysAgo, 0);
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

test('runApiPath takes owner/repo from the run_url, not the local checkout', () => {
	// The e2e lanes run in positron-builds; resolving owner/repo from the working
	// directory instead 404s and blanks every date in the failure table.
	assert.equal(
		runApiPath('https://github.com/posit-dev/positron-builds/actions/runs/30986925837'),
		'repos/posit-dev/positron-builds/actions/runs/30986925837'
	);
	assert.equal(
		runApiPath('https://github.com/posit-dev/positron/actions/runs/42'),
		'repos/posit-dev/positron/actions/runs/42'
	);
	assert.equal(runApiPath('https://d38p2avprg8il3.cloudfront.net/playwright-report/index.html'), null);
	assert.equal(runApiPath(null), null);
});

test('daysSince rounds up and never returns zero', () => {
	const now = Date.parse('2026-08-10T12:00:00Z');
	assert.equal(daysSince('2026-08-01T12:00:00Z', now), 9);
	// A fix merged hours ago is still one day of window, not zero.
	assert.equal(daysSince('2026-08-10T09:00:00Z', now), 1);
	assert.equal(daysSince('not-a-date', now), null);
});

test('deriveFixHeld builds the baseline from the pre-fix remainder, not the full window', () => {
	// 400 scoped runs total, 100 of them since the fix; 21 failures total, 1 after.
	const r = deriveFixHeld({
		scopedRunsFull: 400, scopedRunsPost: 100,
		failuresFull: 21, failuresPost: 1,
		environments: ['ubuntu/electron'],
	});
	assert.equal(r.usable, true);
	assert.equal(r.postFixRuns, 100);
	assert.equal(r.postFixFailures, 1);
	// Baseline is the 300 pre-fix runs and the 20 failures in them -- NOT 21/400,
	// which would let the fix's own clean runs dilute the rate it is judged against.
	assert.equal(r.baselineRuns, 300);
	assert.equal(r.baselineFailures, 20);
	assert.equal(r.baselineRate, 20 / 300);
	assert.equal(r.environment, 'ubuntu/electron');
});

test('deriveFixHeld refuses when the lookback does not reach before the fix', () => {
	const r = deriveFixHeld({ scopedRunsFull: 100, scopedRunsPost: 100, failuresFull: 5, failuresPost: 5, environments: ['ubuntu/electron'] });
	assert.equal(r.usable, false);
	assert.match(r.note, /no pre-fix baseline/);
});

test('deriveFixHeld refuses when a window has no environment breakdown', () => {
	// Unscoped runs are the trap this whole path exists to avoid, so a missing
	// breakdown must fail rather than fall back to an all-environment total.
	const r = deriveFixHeld({ scopedRunsFull: 400, scopedRunsPost: null, failuresFull: 21, failuresPost: 1, environments: ['ubuntu/electron'] });
	assert.equal(r.usable, false);
	assert.equal(r.postFixRuns, null);
	assert.match(r.note, /cannot be scoped/);
});

test('deriveFixHeld flags a zero baseline rate as uninformative', () => {
	// Never failed before the fix either: a clean streak after it proves nothing.
	const r = deriveFixHeld({ scopedRunsFull: 400, scopedRunsPost: 100, failuresFull: 2, failuresPost: 2, environments: ['ubuntu/electron'] });
	assert.equal(r.baselineFailures, 0);
	assert.equal(r.baselineRate, 0);
	assert.match(r.note, /says nothing about the fix/);
});

test('mergeHistory carries the untruncated pattern text for cross-window matching', () => {
	const long = 'Error: expect(locator).toBeVisible() failed because ' + 'x'.repeat(200);
	const { patterns } = mergeHistory(null, mkTest(50, [{ pattern: long, count: 1, occurrences: [occ('m1')] }], [env('ubuntu', 'electron', 50)]), 'main', 1);
	assert.equal(patterns[0].fullPattern, long);
	// The headline is what the table shows; it is lossy, so it cannot be the match key.
	assert.notEqual(patterns[0].failure, long);
});

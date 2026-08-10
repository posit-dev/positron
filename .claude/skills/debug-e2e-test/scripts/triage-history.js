#!/usr/bin/env node
// triage-history.js -- compact, dual-branch failure-history retrieval.
//
// Wraps e2e-failure-analyzer/scripts/e2e-query-history.js: resolves the branch,
// queries the current branch and main, merges their failure patterns by failure
// text, computes counts/percentages/seen-on/last-seen, detects zero-run conditions,
// selects ONE representative occurrence per pattern, writes the full responses
// to disk, and prints only a compact JSON summary to stdout.
//
// Flags: see CLI below, or run with --help.
//
// Output (stdout): compact JSON { testKey, branchSummary, patterns[], verdict,
//   summaryFile, rawResultFile }. Full API responses are written to disk.
// Exit code: 0 on success, 1 with { error } when the API is unreachable.

import path from 'path';
import {
	analyzerScript, triageDir, deriveTriageId, ensureDir,
	writeJson, emit, fail, runNode, tryRun, isMain, parseArgs,
	insightsApiKeyPresent, resolveInsightsApiKey, MISSING_API_KEY_HELP,
	defineCli, handleHelp,
} from './lib.js';

export const CLI = defineCli({
	name: 'triage-history.js',
	summary: 'dual-branch failure history, merged into one pattern list',
	usage: ["--test-key '<testName>|||<specPath>' [options]"],
	flags: [
		{ name: 'test-key', value: '<key>', required: true, description: 'testName|||specPath' },
		{ name: 'repo', value: '<id>', description: 'test-health repo id (default: positron)' },
		{ name: 'branch', value: '<branch>', description: 'override the current branch (skips the git lookup)' },
		{ name: 'lookback-days', value: '<n>', description: '1-30 (default: 14)' },
		{ name: 'occurrences-per-pattern', value: '<n>', description: 'default 1; raise to 2 only for a listed escalation reason' },
		{ name: 'triage-id', value: '<id>', description: 'work-dir id (default: derived from the test key)' },
		{ name: 'since-fix', value: '<iso-date>', description: "a merged fix's date (mergedAt from find-prior-triage.js); adds per-pattern fixHeld numbers to feed back into its sufficiency scoring" },
	],
});

/** Whole days between an ISO date and now, at least 1. */
export function daysSince(isoDate, now = Date.now()) {
	const t = Date.parse(isoDate);
	if (!Number.isFinite(t)) { return null; }
	return Math.max(1, Math.ceil((now - t) / 86400000));
}

/**
 * Split a pattern's history into the window since a fix merged and everything
 * before it, so "did the fix hold?" gets a denominator instead of a vibe.
 *
 * Both windows are scoped to the environments the pattern actually occurs in --
 * the same scoping `rates` uses, and the reason this cannot be done by
 * subtracting raw totals: an all-environment run count paired with a
 * lane-specific failure rate inflates N and clears the sufficiency bar on runs
 * that never exercised the failing lane.
 *
 * The baseline is the *pre-fix* remainder (full window minus the post-fix
 * window), never the full window itself: including post-fix runs in the baseline
 * drags the rate toward zero exactly when the fix worked, which flatters the fix
 * with its own evidence.
 *
 * @returns {{usable: boolean, note: string|null, postFixRuns: number|null,
 *   postFixFailures: number, baselineRuns: number|null, baselineFailures: number,
 *   baselineRate: number|null, environment: string|null}}
 */
export function deriveFixHeld({ scopedRunsFull, scopedRunsPost, failuresFull, failuresPost, environments }) {
	const environment = environments?.length ? environments.join(',') : null;
	const base = {
		postFixRuns: scopedRunsPost ?? null,
		postFixFailures: failuresPost,
		baselineRuns: null,
		baselineFailures: failuresFull - failuresPost,
		baselineRate: null,
		environment,
	};
	if (scopedRunsFull == null || scopedRunsPost == null) {
		return { ...base, usable: false, note: 'No environment breakdown for one of the windows, so the post-fix runs cannot be scoped to the failing lane.' };
	}
	const baselineRuns = scopedRunsFull - scopedRunsPost;
	if (baselineRuns <= 0) {
		return { ...base, baselineRuns, usable: false, note: 'The lookback window does not reach back before the fix, so there is no pre-fix baseline. Re-run with a longer --lookback-days.' };
	}
	const baselineFailures = failuresFull - failuresPost;
	return {
		...base,
		baselineRuns,
		baselineFailures,
		baselineRate: baselineFailures > 0 ? baselineFailures / baselineRuns : 0,
		usable: true,
		note: baselineFailures > 0 ? null : 'No pre-fix failures in this window either, so a clean post-fix streak says nothing about the fix.',
	};
}

/** Normalize a failure-pattern string into a stable cross-branch match key. */
export function normalizePattern(pattern) {
	return String(pattern || '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 160)
		.toLowerCase();
}

/** First non-empty line of a pattern, for compact display. */
export function patternHeadline(pattern) {
	const line = String(pattern || '').split('\n').map(s => s.trim()).find(Boolean) || '';
	return line.slice(0, 200);
}

function occEnvironments(occurrences) {
	const envs = new Set();
	for (const o of occurrences || []) {
		if (o.os || o.browser) { envs.add([o.os, o.browser].filter(Boolean).join('/')); }
	}
	return [...envs];
}

function envKey(os, browser) {
	return [os, browser].filter(Boolean).join('/');
}

const occurrenceDateCache = new Map();

/**
 * `repos/{owner}/{repo}/actions/runs/{id}` for a run_url, or null when the URL is
 * not a workflow-run URL.
 *
 * The owner/repo must come from the URL, never from gh's working-directory
 * default: the e2e lanes run in posit-dev/positron-builds, so letting gh resolve
 * them against a positron checkout 404s on every occurrence and silently reports
 * `lastSeen.date: null` for the whole failure table -- which also disables the
 * "is this pattern already fixed?" read that recency exists to support.
 */
export function runApiPath(runUrl) {
	const m = String(runUrl || '').match(/github\.com\/([^/]+)\/([^/]+)\/actions\/runs\/(\d+)/);
	return m ? `repos/${m[1]}/${m[2]}/actions/runs/${m[3]}` : null;
}

/**
 * Calendar date of one failure occurrence. The test-health API returns no
 * timestamp on occurrences, so derive one: the local git commit date of the sha
 * (offline and instant, and within minutes of the CI run), falling back to the
 * GitHub run's created_at when the sha is not in the local clone (shallow clone,
 * force-push, or a branch never fetched). Returns null when neither answers.
 */
export function occurrenceDate(o) {
	const key = o?.sha || o?.run_url;
	if (!key) { return null; }
	if (occurrenceDateCache.has(key)) { return occurrenceDateCache.get(key); }

	let iso = null;
	if (o.sha) {
		const r = tryRun('git', ['show', '-s', '--format=%cI', o.sha]);
		if (r.ok) { iso = r.stdout.trim().split('\n').pop() || null; }
	}
	if (!iso && o.run_url) {
		const apiPath = runApiPath(o.run_url);
		if (apiPath) {
			const r = tryRun('gh', ['api', apiPath, '--jq', '.created_at']);
			if (r.ok) { iso = r.stdout.trim() || null; }
		}
	}
	occurrenceDateCache.set(key, iso);
	return iso;
}

/**
 * Most recent occurrence of a pattern. Recency is what separates an acute burst
 * that a merged fix already closed from an ongoing drip -- without it a stale
 * pattern and a live one look identical in the failure table.
 *
 * Occurrences arrive most-recent-first from the API, so index 0 is the fallback
 * identity when no date resolves: a stale clone must still report *which*
 * occurrence was latest, just without a date.
 */
export function resolveLastSeen(occurrences, dateFor, now = Date.now()) {
	let best = null;
	for (const o of occurrences || []) {
		const t = Date.parse(dateFor(o) || '');
		if (Number.isNaN(t)) { continue; }
		if (!best || t > best.t) { best = { t, iso: dateFor(o), o }; }
	}
	if (!best) {
		const first = (occurrences || [])[0];
		return first ? { date: null, daysAgo: null, sha: first.sha ?? null } : null;
	}
	return {
		date: best.iso.slice(0, 10),
		daysAgo: Math.max(0, Math.round((now - best.t) / 86400000)),
		sha: best.o.sha ?? null,
	};
}

/**
 * Sum `total_runs` from a test object's `environment_breakdown` for exactly the
 * environments a pattern occurred in. Returns null when the breakdown is
 * missing or none of its entries match (so callers can tell "no data" apart
 * from a genuine zero).
 */
export function scopedRunsForEnvironments(environmentBreakdown, environments) {
	if (!Array.isArray(environmentBreakdown) || !environments.length) { return null; }
	let sum = 0;
	let matched = false;
	for (const e of environmentBreakdown) {
		if (environments.includes(envKey(e.os, e.browser))) {
			sum += e.total_runs || 0;
			matched = true;
		}
	}
	return matched ? sum : null;
}

/**
 * Merge the current-branch and main test objects into a single ordered pattern
 * list. Patterns are matched across branches by normalized failure text, never
 * by array position. Each merged pattern is classified as seen on the current
 * branch only, main only, or both.
 *
 * @param {object|null} current  tests[0] from the current-branch response (null if not queried)
 * @param {object|null} main     tests[0] from the main response (null if not queried)
 * @param {string} currentBranch
 * @param {number} occurrencesPerPattern
 */
/**
 * Spreadsheet-style pattern label: A..Z, then AA, AB, ... so 27+ patterns keep
 * getting stable letter ids (used as selectedPattern values and evidence
 * sub-directory names) instead of overflowing into non-letter ASCII.
 */
export function patternLabel(i) {
	let n = i;
	let label = '';
	do {
		label = String.fromCharCode(65 + (n % 26)) + label;
		n = Math.floor(n / 26) - 1;
	} while (n >= 0);
	return label;
}

export function mergeHistory(current, main, currentBranch, occurrencesPerPattern = 1, dateFor = () => null) {
	const byKey = new Map();

	const ingest = (testObj, branchLabel) => {
		for (const p of (testObj?.failure_patterns || [])) {
			const key = normalizePattern(p.pattern);
			if (!byKey.has(key)) {
				byKey.set(key, {
					failure: patternHeadline(p.pattern),
					fullPattern: p.pattern,
					branches: new Set(),
					count: 0,
					branchCounts: new Map(),
					environments: new Set(),
					occurrences: [],
				});
			}
			const entry = byKey.get(key);
			entry.branches.add(branchLabel);
			entry.count += p.count || 0;
			entry.branchCounts.set(branchLabel, (entry.branchCounts.get(branchLabel) || 0) + (p.count || 0));
			for (const e of occEnvironments(p.occurrences)) { entry.environments.add(e); }
			for (const o of (p.occurrences || [])) {
				entry.occurrences.push({ branch: branchLabel, ...o });
			}
		}
	};

	ingest(current, currentBranch);
	ingest(main, 'main');

	const currentRuns = current?.history?.total_runs ?? null;
	const mainRuns = main?.history?.total_runs ?? null;
	const totalRuns = (currentRuns || 0) + (mainRuns || 0);
	const breakdownByBranch = { [currentBranch]: current?.environment_breakdown, main: main?.environment_breakdown };

	const patterns = [...byKey.values()]
		.sort((a, b) => b.count - a.count)
		.map((entry, i) => {
			const hasCurrent = entry.branches.has(currentBranch);
			const hasMain = entry.branches.has('main');
			const seenOn = hasCurrent && hasMain ? 'both'
				: hasCurrent ? `${currentBranch} only`
					: 'main only';
			// One representative occurrence by default; prefer a current-branch one.
			const rep = entry.occurrences.find(o => o.branch === currentBranch) || entry.occurrences[0] || null;
			const kept = entry.occurrences.slice(0, occurrencesPerPattern);
			const environments = [...entry.environments];
			// Per-branch rate scoped to the environments this pattern actually occurred
			// in -- NOT count/totalRuns (that blends branches and environments together
			// and can understate a pattern by 100x when it is concentrated in one
			// environment on one branch; see triage-history.md).
			const rates = [...entry.branchCounts.entries()].map(([branch, count]) => {
				const environmentRuns = scopedRunsForEnvironments(breakdownByBranch[branch], environments);
				return {
					branch,
					count,
					environmentRuns,
					ratePercent: environmentRuns ? Math.round((count / environmentRuns) * 1000) / 10 : null,
				};
			});
			return {
				id: patternLabel(i), // A, B, .. Z, AA, AB, ...
				failure: entry.failure,
				// The untruncated text, kept for cross-window matching (--since-fix).
				// `failure` is a headline and two distinct patterns can share one.
				fullPattern: entry.fullPattern,
				count: entry.count,
				rates,
				environments,
				seenOn,
				lastSeen: resolveLastSeen(entry.occurrences, dateFor),
				representativeOccurrence: rep && {
					branch: rep.branch, sha: rep.sha, os: rep.os,
					browser: rep.browser, outcome: rep.outcome, report_url: rep.report_url,
				},
				keptOccurrences: kept,
			};
		});

	return { patterns, currentRuns, mainRuns, totalRuns };
}

/**
 * Classify the overall result. Zero-runs is evaluated per branch, never on the
 * merged total: a new branch with no CI runs of its own is expected, but both
 * branches at zero means a test-key mismatch masquerading as a clean record.
 */
export function classifyVerdict({ currentBranch, currentRuns, mainRuns, patternCount, queriedCurrent }) {
	const currentZero = queriedCurrent && (currentRuns === 0 || currentRuns === null);
	const mainZero = mainRuns === 0 || mainRuns === null;

	if (queriedCurrent && currentZero && mainZero) {
		return { verdict: 'zero-runs-both', stop: true, note: 'Both branches report total_runs=0 -- treat as a test-key mismatch (rebuild the full hierarchical key), not a clean record.' };
	}
	if (!queriedCurrent && mainZero) {
		// Triaging on main directly: main is the only branch queried, so zero runs
		// there is the same mismatch signal -- not a clean record.
		return { verdict: 'zero-runs-both', stop: true, note: 'main reports total_runs=0 -- treat as a test-key mismatch (rebuild the full hierarchical key), not a clean record.' };
	}
	if (patternCount === 0) {
		return { verdict: 'clean', stop: true, note: 'Nonzero runs and no failure patterns -- nothing to triage.' };
	}
	if (queriedCurrent && currentZero) {
		return { verdict: 'ok-current-branch-new', stop: false, note: `${currentBranch} has no CI runs of its own yet; proceeding on main history.` };
	}
	return { verdict: 'ok', stop: false };
}

function queryBranch(scriptPath, { repo, testKey, branch, lookbackDays, occ }) {
	const out = runNode(scriptPath, [
		'--repo', repo,
		'--test-keys', JSON.stringify([testKey]),
		'--branch', branch,
		'--lookback-days', String(lookbackDays),
		'--occurrences-per-pattern', String(occ),
	], { E2E_INSIGHTS_API_KEY: resolveInsightsApiKey() ?? '' });
	let data;
	try { data = JSON.parse(out); } catch { data = {}; }
	return data;
}

function main() {
	handleHelp(CLI, process.argv.slice(2));
	const args = parseArgs(process.argv.slice(2), CLI.booleanFlags);
	const testKey = args['test-key'];
	if (!testKey || !testKey.includes('|||')) {
		fail('Missing or malformed --test-key (expected "testName|||specPath").');
	}
	// Pre-flight: without a key every query returns {}, which is indistinguishable
	// from a real outage. Fail as a setup problem, with the steps, before querying --
	// and before creating a work dir, so a first-run setup gap leaves no debris.
	if (!insightsApiKeyPresent()) {
		fail(MISSING_API_KEY_HELP, { cause: 'missing-api-key' });
	}

	const repo = args.repo || 'positron';
	const lookbackDays = Number(args['lookback-days'] || 14);

	// Validate --since-fix before any query: an unusable date or too-short window
	// is a caller error, and finding it after two API round-trips just wastes them.
	let daysSinceFix = null;
	if (args['since-fix']) {
		daysSinceFix = daysSince(args['since-fix']);
		if (daysSinceFix === null) { fail(`--since-fix "${args['since-fix']}" is not a parseable date (expected the mergedAt ISO timestamp from find-prior-triage.js).`); }
		if (daysSinceFix > lookbackDays) {
			fail(`--since-fix is ${daysSinceFix}d ago but --lookback-days is ${lookbackDays}, so the window holds no pre-fix baseline. Re-run with --lookback-days ${Math.min(30, daysSinceFix + 7)}.`,
				{ cause: 'lookback-too-short', daysSinceFix });
		}
	}
	const occ = Number(args['occurrences-per-pattern'] || 1);
	const triageId = args['triage-id'] || deriveTriageId(testKey);
	const dir = triageDir(triageId);
	ensureDir(dir);

	let currentBranch = args.branch;
	if (!currentBranch) {
		const r = tryRun('git', ['branch', '--show-current']);
		currentBranch = r.ok ? r.stdout.trim() : 'main';
	}

	const scriptPath = analyzerScript('e2e-query-history.js');
	const queriedCurrent = currentBranch !== 'main';

	const currentData = queriedCurrent
		? queryBranch(scriptPath, { repo, testKey, branch: currentBranch, lookbackDays, occ })
		: null;
	const mainData = queryBranch(scriptPath, { repo, testKey, branch: 'main', lookbackDays, occ });

	// An empty {} means the API was unreachable for that call -- surface and stop.
	if ((queriedCurrent && Object.keys(currentData).length === 0) || Object.keys(mainData).length === 0) {
		fail('test-health API unreachable (empty response). A key was found, so this is an API-side or network failure, not setup -- retry, then check the dashboard. Do not treat this as "no failures".', { triageId, cause: 'api-unreachable' });
	}

	const rawFile = writeJson(path.join(dir, 'history-raw.json'), { currentBranch, currentData, mainData });

	const currentTest = (currentData?.tests || [])[0] || null;
	const mainTest = (mainData?.tests || [])[0] || null;
	const testDetailViewUrl = mainTest?.test_detail_view_url || currentTest?.test_detail_view_url || null;
	const testName = (mainTest || currentTest)?.testName || testKey.split('|||')[0];
	const specPath = (mainTest || currentTest)?.specPath || testKey.split('|||')[1];

	// The API's own coarse recency/onset label ("Started" / "yesterday"). Independent
	// of per-occurrence dates, so it still answers "is this pattern current?" when
	// date resolution comes up empty.
	const insight = mainTest?.insight || currentTest?.insight || null;

	const merged = mergeHistory(currentTest, mainTest, currentBranch, occ, occurrenceDate);

	// --since-fix: a second, shorter query bounded by the fix's merge date. A fix
	// merges to main, so "did it hold?" is a question about main -- the current
	// branch's own runs predate the merge or duplicate it.
	let fixHeldByPattern = null;
	if (daysSinceFix !== null) {
		const postData = queryBranch(scriptPath, { repo, testKey, branch: 'main', lookbackDays: daysSinceFix, occ: 1 });
		if (Object.keys(postData).length === 0) {
			fail('test-health API unreachable on the --since-fix query.', { triageId, cause: 'api-unreachable' });
		}
		const postTest = (postData?.tests || [])[0] || null;
		const postBreakdown = postTest?.environment_breakdown;
		const mainBreakdown = mainTest?.environment_breakdown;
		fixHeldByPattern = {};
		for (const p of merged.patterns) {
			const failuresFull = p.rates.find(r => r.branch === 'main')?.count ?? 0;
			// Matched on the same normalized full text mergeHistory keys on, so a
			// pattern present in both windows is the same pattern in both.
			const failuresPost = (postTest?.failure_patterns || [])
				.filter(fp => normalizePattern(fp.pattern) === normalizePattern(p.fullPattern))
				.reduce((n, fp) => n + (fp.count || 0), 0);
			fixHeldByPattern[p.id] = {
				sinceFix: args['since-fix'],
				daysSinceFix,
				...deriveFixHeld({
					scopedRunsFull: scopedRunsForEnvironments(mainBreakdown, p.environments),
					scopedRunsPost: scopedRunsForEnvironments(postBreakdown, p.environments),
					failuresFull,
					failuresPost,
					environments: p.environments,
				}),
			};
		}
	}

	const verdict = classifyVerdict({
		currentBranch,
		currentRuns: merged.currentRuns,
		mainRuns: merged.mainRuns,
		patternCount: merged.patterns.length,
		queriedCurrent,
	});

	const summary = {
		triageId,
		testKey,
		testName,
		specPath,
		testDetailViewUrl,
		branchSummary: {
			currentBranch,
			currentBranchRuns: merged.currentRuns,
			mainRuns: merged.mainRuns,
			queriedBranches: queriedCurrent ? [currentBranch, 'main'] : ['main'],
		},
		patterns: merged.patterns.map(p => ({
			id: p.id, failure: p.failure, count: p.count, rates: p.rates,
			environments: p.environments, seenOn: p.seenOn, lastSeen: p.lastSeen,
			representativeOccurrence: p.representativeOccurrence,
			...(fixHeldByPattern ? { fixHeld: fixHeldByPattern[p.id] } : {}),
		})),
		onset: insight ? {
			type: insight.type ?? null,
			label: insight.timing_label ?? null,
			value: insight.timing_value ?? null,
			firstFailureSha: insight.first_failure_sha ?? null,
		} : null,
		verdict: verdict.verdict,
		stop: verdict.stop,
		note: verdict.note,
		lookbackDays,
		queriedAt: new Date().toISOString(),
		rawResultFile: path.relative(process.cwd(), rawFile),
	};

	const summaryFile = writeJson(path.join(dir, 'history-summary.json'), summary);
	emit({ ...summary, summaryFile: path.relative(process.cwd(), summaryFile) });
}

if (isMain(import.meta.url)) { main(); }

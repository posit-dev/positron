#!/usr/bin/env node
// triage-history.js -- compact, dual-branch failure-history retrieval.
//
// Wraps e2e-failure-analyzer/scripts/e2e-query-history.js: resolves the branch,
// queries the current branch and main, merges their failure patterns by failure
// text, computes counts/percentages/seen-on, detects zero-run conditions,
// selects ONE representative occurrence per pattern, writes the full responses
// to disk, and prints only a compact JSON summary to stdout.
//
// Usage:
//   node triage-history.js --test-key '<testName>|||<specPath>' [options]
//
// Options:
//   --test-key <key>              testName|||specPath  [required]
//   --repo <id>                   test-health repo id (default: positron)
//   --branch <branch>             override the current branch (skips git lookup)
//   --lookback-days <n>           1-30 (default: 14)
//   --occurrences-per-pattern <n> default: 1 (fetch a 2nd only with a stated reason)
//   --triage-id <id>              work-dir id (default: derived from the test key)
//
// Output (stdout): compact JSON { testKey, branchSummary, patterns[], verdict,
//   summaryFile, rawResultFile }. Full API responses are written to disk.
// Exit code: 0 on success, 1 with { error } when the API is unreachable.

import path from 'path';
import {
	analyzerScript, triageDir, deriveTriageId, ensureDir,
	writeJson, emit, fail, runNode, tryRun, isMain, parseArgs,
} from './lib.js';

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
export function mergeHistory(current, main, currentBranch, occurrencesPerPattern = 1) {
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
					environments: new Set(),
					occurrences: [],
				});
			}
			const entry = byKey.get(key);
			entry.branches.add(branchLabel);
			entry.count += p.count || 0;
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
			return {
				id: String.fromCharCode(65 + i), // A, B, C, ...
				failure: entry.failure,
				count: entry.count,
				percentage: totalRuns ? Math.round((entry.count / totalRuns) * 1000) / 10 : null,
				environments: [...entry.environments],
				seenOn,
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
	]);
	let data;
	try { data = JSON.parse(out); } catch { data = {}; }
	return data;
}

function main() {
	const args = parseArgs(process.argv.slice(2));
	const testKey = args['test-key'];
	if (!testKey || !testKey.includes('|||')) {
		fail('Missing or malformed --test-key (expected "testName|||specPath").');
	}
	const repo = args.repo || 'positron';
	const lookbackDays = Number(args['lookback-days'] || 14);
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
		fail('test-health API unreachable (empty response). Check E2E_INSIGHTS_API_KEY; do not treat this as "no failures".', { triageId });
	}

	const rawFile = writeJson(path.join(dir, 'history-raw.json'), { currentBranch, currentData, mainData });

	const currentTest = (currentData?.tests || [])[0] || null;
	const mainTest = (mainData?.tests || [])[0] || null;
	const testDetailViewUrl = mainTest?.test_detail_view_url || currentTest?.test_detail_view_url || null;
	const testName = (mainTest || currentTest)?.testName || testKey.split('|||')[0];
	const specPath = (mainTest || currentTest)?.specPath || testKey.split('|||')[1];

	const merged = mergeHistory(currentTest, mainTest, currentBranch, occ);
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
			id: p.id, failure: p.failure, count: p.count, percentage: p.percentage,
			environments: p.environments, seenOn: p.seenOn,
			representativeOccurrence: p.representativeOccurrence,
		})),
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

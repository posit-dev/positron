#!/usr/bin/env node
// find-prior-triage.js -- filtered prior-triage lookup (replaces pulling ~50
// full PR bodies into context).
//
// Searches merged/open PRs carrying an "E2E Triage Diagnosis" block, filters to
// the ones whose body names THIS test's spec path, extracts the diagnosis
// fields, resolves merge SHAs, and partitions the supplied occurrence SHAs into
// before-fix / after-fix by git ancestry. Full search results go to disk; only
// a compact verdict is printed.
//
// Usage:
//   node find-prior-triage.js --spec-path <path> [--occurrence-shas '["sha",...]'] [options]
//
// Options:
//   --spec-path <path>           exact spec path from the test key  [required]
//   --occurrence-shas <json>     JSON array of occurrence SHAs to test for ancestry
//   --fix-sha <sha>              treat this commit as a merged fix even if no PR
//                                body names the spec (POM/helper-only fixes)
//   --post-fix-runs <n>          CI runs of this test since the fix -- the
//                                denominator, without which "held" is unprovable
//   --baseline-rate <p>          pre-fix per-run failure rate (0-1), to score how
//                                much a clean post-fix streak is actually worth
//   --environment <os/browser>   lane both numbers above describe (e.g.
//                                ubuntu/chromium); omitting it warns, since an
//                                all-env run total inflates the denominator
//   --repo <owner/repo>          default: posit-dev/positron
//   --triage-id <id>             work-dir id  [required for disk output]
//   --limit <n>                  PR search limit (default: 50)
//
// Output (stdout): compact JSON { openAttempts[], mergedAttempts[], sufficiency,
//   verdict, rawResultFile }. Exit 0; on gh failure prints { error }.

import path from 'path';
import {
	triageDir, ensureDir, writeJson, emit, fail, tryRun, isMain, parseArgs,
} from './lib.js';

/** True when a PR body names this exact spec path (the per-test filter). */
export function bodyNamesSpec(body, specPath) {
	return typeof body === 'string' && body.includes(specPath);
}

/**
 * Pull the diagnosis fields out of an "E2E Triage Diagnosis" block body.
 * Returns the one-line hypothesis, targeted failure, and confidence if present.
 */
export function extractDiagnosisFields(body) {
	const text = String(body || '');
	const summary = text.match(/<summary>[\s\S]*?confidence[\s\S]*?--\s*([\s\S]+?)<\/summary>/i);
	const hypothesis = text.match(/\*\*Hypothesis:\*\*\s*(.+)/);
	const targeted = text.match(/\*\*Targeted failure:\*\*\s*(.+)/);
	const confidence = text.match(/(high|medium|low)\s*confidence/i);
	return {
		hypothesis: (hypothesis?.[1] || summary?.[1] || '').trim() || null,
		targetedFailure: (targeted?.[1] || '').trim() || null,
		confidence: confidence ? confidence[1].toLowerCase() : null,
	};
}

/**
 * Score whether a clean post-fix streak is strong enough to call a fix held.
 *
 * Absence of post-fix failures is only evidence in proportion to how many runs
 * produced it: at a baseline failure rate `p`, N clean runs would happen by luck
 * with probability `(1-p)^N` even if nothing were fixed. Without a denominator
 * at all, a clean streak is worth nothing, so `postFixRuns: null` is never
 * meaningful -- that is the difference between "no failures seen" and "held".
 *
 * Both numbers must describe the SAME single environment. Most flakes are
 * environment-specific, and pairing an env-specific rate with an all-env run
 * total inflates N (a test-health `total_runs` spans every os/browser lane), which
 * shrinks `(1-p)^N` and clears the bar on runs that never exercised the failing
 * lane. `environment` is recorded so the verdict is self-describing, and its
 * absence raises `scopeWarning` rather than being silently assumed safe.
 *
 * @param {{postFixRuns: number|null, baselineRate: number|null, environment?: string|null,
 *          alpha?: number, floor?: number}} o
 * @returns {{meaningful: boolean, postFixRuns: number|null, baselineRate: number|null,
 *            environment: string|null, scopeWarning: string|null,
 *            probabilityIfUnfixed: number|null, runsNeeded: number|null}}
 */
export function assessSufficiency({ postFixRuns, baselineRate, environment = null, alpha = 0.05, floor = 10 }) {
	const n = Number.isFinite(postFixRuns) ? postFixRuns : null;
	const p = Number.isFinite(baselineRate) && baselineRate > 0 && baselineRate < 1 ? baselineRate : null;
	const scopeWarning = (n !== null && !environment)
		? 'postFixRuns/baselineRate have no --environment: confirm both describe one os/browser lane, not an all-env total.'
		: null;
	const base = { postFixRuns: n, baselineRate: p, environment: environment || null, scopeWarning };
	if (n === null) {
		return { ...base, meaningful: false, probabilityIfUnfixed: null, runsNeeded: null };
	}
	if (p === null) {
		// No baseline to score against: fall back to a plain run-count floor.
		return { ...base, meaningful: n >= floor, probabilityIfUnfixed: null, runsNeeded: floor };
	}
	const probabilityIfUnfixed = Math.pow(1 - p, n);
	const runsNeeded = Math.ceil(Math.log(alpha) / Math.log(1 - p));
	return { ...base, meaningful: probabilityIfUnfixed <= alpha, probabilityIfUnfixed, runsNeeded };
}

/**
 * Derive the overall reconciliation verdict from the classified attempts.
 * afterFixCount is the number of supplied occurrences that post-date the most
 * recent merged fix; runsMeaningful comes from `assessSufficiency` and is true
 * only when enough post-fix runs have accrued to judge "held".
 */
export function deriveVerdict({ openAttempts, mergedAttempts, afterFixCount, runsMeaningful }) {
	if (openAttempts.length > 0) { return 'open-attempt-in-flight'; }
	if (mergedAttempts.length === 0) { return 'none'; }
	if (afterFixCount > 0) { return 'recurred-after-fix'; }
	if (!runsMeaningful) { return 'too-recent-to-tell'; }
	return 'fix-holding';
}

function ghSearch(repo, limit) {
	const r = tryRun('gh', [
		'search', 'prs', '--repo', repo, '--match', 'body',
		'E2E Triage Diagnosis',
		'--json', 'number,title,url,state,body', '--limit', String(limit),
	]);
	if (!r.ok) { return { ok: false, stderr: r.stderr }; }
	try { return { ok: true, prs: JSON.parse(r.stdout) }; }
	catch { return { ok: false, stderr: 'could not parse gh search output' }; }
}

function mergeInfo(repo, number) {
	const r = tryRun('gh', ['pr', 'view', String(number), '--repo', repo, '--json', 'mergeCommit,mergedAt,state']);
	if (!r.ok) { return null; }
	try {
		const j = JSON.parse(r.stdout);
		return { mergeSha: j.mergeCommit?.oid || null, mergedAt: j.mergedAt || null, state: j.state };
	} catch { return null; }
}

/** Occurrences that are descendants of the fix commit = failures after the fix. */
function ancestryAfterFix(mergeSha, shas) {
	if (!mergeSha) { return { afterFix: [], beforeFix: [], unknown: shas.slice() }; }
	const afterFix = [], beforeFix = [], unknown = [];
	let fetched = false;
	for (const sha of shas) {
		let r = tryRun('git', ['merge-base', '--is-ancestor', mergeSha, sha]);
		if (r.status === 128 && !fetched) { // sha not in local clone
			tryRun('git', ['fetch', 'origin']);
			fetched = true;
			r = tryRun('git', ['merge-base', '--is-ancestor', mergeSha, sha]);
		}
		if (r.status === 0) { afterFix.push(sha); }
		else if (r.status === 1) { beforeFix.push(sha); }
		else { unknown.push(sha); }
	}
	return { afterFix, beforeFix, unknown };
}

function main() {
	const args = parseArgs(process.argv.slice(2));
	const specPath = args['spec-path'];
	if (!specPath) { fail('Missing --spec-path.'); }
	const repo = args.repo || 'posit-dev/positron';
	const limit = Number(args.limit || 50);
	const triageId = args['triage-id'];
	let shas = [];
	if (args['occurrence-shas']) {
		try { shas = JSON.parse(args['occurrence-shas']); } catch { fail('--occurrence-shas must be a JSON array.'); }
	}
	const fixSha = args['fix-sha'] || null;
	const postFixRuns = args['post-fix-runs'] === undefined ? null : Number(args['post-fix-runs']);
	const baselineRate = args['baseline-rate'] === undefined ? null : Number(args['baseline-rate']);
	const environment = args.environment || null;

	const search = ghSearch(repo, limit);
	if (!search.ok) { fail(`gh search failed: ${search.stderr}`, { triageId }); }

	const matches = search.prs.filter(p => bodyNamesSpec(p.body, specPath));

	const openAttempts = [];
	const mergedAttempts = [];
	for (const p of matches) {
		const fields = extractDiagnosisFields(p.body);
		if (p.state === 'open') {
			openAttempts.push({ number: p.number, url: p.url, title: p.title, ...fields });
			continue;
		}
		const info = mergeInfo(repo, p.number);
		const anc = ancestryAfterFix(info?.mergeSha, shas);
		mergedAttempts.push({
			number: p.number, url: p.url, mergedAt: info?.mergedAt || null,
			mergeSha: info?.mergeSha || null, ...fields,
			afterFixShas: anc.afterFix, beforeFixShas: anc.beforeFix, unknownShas: anc.unknown,
			afterFixFailureCount: anc.afterFix.length,
		});
	}

	// A fix that only touched a POM, fixture, or helper never names the spec, so
	// the search above misses it entirely. --fix-sha lets the caller supply it so
	// the ancestry partition and verdict still apply.
	if (fixSha && mergedAttempts.length === 0) {
		const anc = ancestryAfterFix(fixSha, shas);
		mergedAttempts.push({
			number: null, url: null, mergedAt: null, mergeSha: fixSha,
			hypothesis: null, targetedFailure: null, confidence: null,
			source: 'fix-sha-override',
			afterFixShas: anc.afterFix, beforeFixShas: anc.beforeFix, unknownShas: anc.unknown,
			afterFixFailureCount: anc.afterFix.length,
		});
	}

	const afterFixCount = mergedAttempts.reduce((n, m) => n + m.afterFixFailureCount, 0);
	// Occurrence SHAs supply the numerator only. Judging "held" needs the
	// denominator too -- how many runs produced the clean streak -- so an absent
	// --post-fix-runs yields too-recent-to-tell, never a false "fix-holding".
	const sufficiency = assessSufficiency({ postFixRuns, baselineRate, environment });
	const verdict = deriveVerdict({ openAttempts, mergedAttempts, afterFixCount, runsMeaningful: sufficiency.meaningful });

	const result = { specPath, openAttempts, mergedAttempts, sufficiency, verdict };

	let rawResultFile = null;
	if (triageId) {
		const dir = ensureDir(triageDir(triageId));
		rawResultFile = writeJson(path.join(dir, 'prior-triage-raw.json'), { searchedRepo: repo, matched: matches.map(m => m.number), result });
		rawResultFile = path.relative(process.cwd(), rawResultFile);
	}

	emit({ ...result, rawResultFile });
}

if (isMain(import.meta.url)) { main(); }

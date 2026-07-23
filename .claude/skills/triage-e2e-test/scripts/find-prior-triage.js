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
//   --repo <owner/repo>          default: posit-dev/positron
//   --triage-id <id>             work-dir id  [required for disk output]
//   --limit <n>                  PR search limit (default: 50)
//
// Output (stdout): compact JSON { openAttempts[], mergedAttempts[], verdict,
//   rawResultFile }. Exit 0; on gh failure prints { error }.

import path from 'path';
import {
	triageDir, ensureDir, writeJson, emit, fail, tryRun, isMain, parseArgs,
	setMetricScript, recordMetric,
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
 * Derive the overall reconciliation verdict from the classified attempts.
 * afterFixCount is the number of supplied occurrences that post-date the most
 * recent merged fix; runsMeaningful signals whether enough runs have accrued
 * since the merge to judge "held".
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
	setMetricScript('find-prior-triage');
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

	const afterFixCount = mergedAttempts.reduce((n, m) => n + m.afterFixFailureCount, 0);
	// We can only tell whether a merged fix held by checking occurrence SHAs for
	// ancestry against the merge commit. With none supplied (--occurrence-shas
	// omitted) there's nothing to check, so the verdict is too-recent-to-tell
	// rather than a false "fix-holding".
	const runsMeaningful = shas.length > 0;
	const verdict = deriveVerdict({ openAttempts, mergedAttempts, afterFixCount, runsMeaningful });

	const result = { specPath, openAttempts, mergedAttempts, verdict };

	let rawResultFile = null;
	if (triageId) {
		const dir = ensureDir(triageDir(triageId));
		rawResultFile = writeJson(path.join(dir, 'prior-triage-raw.json'), { searchedRepo: repo, matched: matches.map(m => m.number), result });
		rawResultFile = path.relative(process.cwd(), rawResultFile);
	}

	emit({ ...result, rawResultFile });
	recordMetric({
		triageId,
		phase: 'prior-triage',
		prsSearched: search.prs.length,
		prsMatched: matches.length,
		occurrenceShasChecked: shas.length,
		verdict,
	});
}

if (isMain(import.meta.url)) { main(); }

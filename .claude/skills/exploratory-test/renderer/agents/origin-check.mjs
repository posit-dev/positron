/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Checks each finding's origin against git, after the verifier. The verifier
// names the lines a fix would change (`fix`) and, for `exposed`, the changed
// line that leads to them (`trigger`); whether those lines are in the change is
// then a fact git settles, not the verifier's word. An origin git does not bear
// out is dropped, so the page shows a dash, and the reason is kept.

import { execFileSync } from 'node:child_process';
import { readReport, reportPath, writeReport } from './finish.mjs';

/** `git -C repo ...args`, its output; throws when git fails. */
export function gitIn(repo) {
	return args => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
}

/**
 * Whether `lines` ({ file, start, end }) are in the change `base..head`: the
 * commits blame gives them that are in the change, and whether the change
 * deleted a line there, which blame cannot see.
 */
export function linesInChange(git, { base, head }, lines, inRange) {
	const blame = git(['blame', '-w', '-M', '-C', '--porcelain', head, '-L', `${lines.start},${lines.end}`, '--', lines.file]);
	const shas = new Set([...blame.matchAll(/^([0-9a-f]{40}) \d+ \d+/gm)].map(m => m[1]));
	const commits = [...shas].filter(sha => inRange.has(sha));
	// A hunk that removes more lines than it adds deleted some; a rewritten line
	// is blame's to see. It sits at its new-side line, or after line c when it adds nothing.
	const diff = git(['diff', '-U0', '--no-color', `${base}...${head}`, '--', lines.file]);
	const deleted = [...diff.matchAll(/^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)].some(([, removed = '1', at, added = '1']) => {
		if (Number(removed) <= Number(added)) {
			return false;
		}
		const from = Number(at);
		const to = from + Math.max(Number(added), 1) - 1;
		return from <= lines.end + 1 && to >= lines.start - 1;
	});
	return { commits, deleted, in: commits.length > 0 || deleted };
}

/**
 * The origin git bears out for one claim, as `{ origin, commits, deleted }`, or
 * `{ origin: null, reason }`. `introduced` needs a fix line in the change;
 * `exposed` none, and a trigger line that is; `inherited` none.
 */
export function checkOrigin(git, range, inRange, { origin, fix, trigger }) {
	if (!fix) {
		return { origin: null, reason: 'no fix location was given' };
	}
	let atFix;
	try {
		atFix = linesInChange(git, range, fix, inRange);
	} catch {
		return { origin: null, reason: `git could not blame ${fix.file}:${fix.start}-${fix.end} at the head` };
	}
	if (origin === 'introduced') {
		return atFix.in ? { origin, commits: atFix.commits, deleted: atFix.deleted } : { origin: null, reason: 'no fix line is in the change' };
	}
	if (atFix.in) {
		return { origin: null, reason: `a fix line is in the change, so it is not ${origin}` };
	}
	if (origin === 'exposed') {
		if (!trigger) {
			return { origin: null, reason: 'exposed with no changed line named' };
		}
		let atTrigger;
		try {
			atTrigger = linesInChange(git, range, trigger, inRange);
		} catch {
			return { origin: null, reason: `git could not blame ${trigger.file}:${trigger.start} at the head` };
		}
		return atTrigger.in ? { origin, commits: atTrigger.commits, deleted: atTrigger.deleted } : { origin: null, reason: 'the named changed line is not in the change' };
	}
	return { origin, commits: [], deleted: false };
}

/**
 * Checks every origin in the run's report.json against git and writes back
 * what holds: `verification.origin` keeps only those, `originEvidence` gets
 * each one's commits, and `originDropped` says why the others went. Returns
 * log lines.
 */
export function checkOrigins(dir, range, { git = gitIn(range.repo) } = {}) {
	const path = reportPath(dir);
	const report = readReport(path);
	const claims = report.verification?.origin;
	if (!claims || !Object.keys(claims).length) {
		return [];
	}
	let inRange;
	try {
		inRange = new Set(git(['rev-list', `${range.base}..${range.head}`]).split('\n').filter(Boolean));
	} catch {
		inRange = null;
	}
	const origin = {};
	const evidence = {};
	const dropped = {};
	for (const [n, claimed] of Object.entries(claims)) {
		const given = report.verification.originEvidence?.[n] ?? {};
		const out = inRange || !given.fix ? checkOrigin(git, range, inRange, { origin: claimed, ...given }) : { origin: null, reason: 'git could not list the change\'s commits' };
		if (out.origin) {
			origin[n] = out.origin;
			evidence[n] = { ...given, commits: out.commits, deleted: out.deleted };
		} else {
			dropped[n] = { claimed, reason: out.reason, ...given };
		}
	}
	const { origin: _o, originEvidence: _e, originDropped: _d, ...rest } = report.verification;
	writeReport(path, {
		...report,
		verification: {
			...rest,
			...(Object.keys(origin).length ? { origin, originEvidence: evidence } : {}),
			...(Object.keys(dropped).length ? { originDropped: dropped } : {}),
		},
	});
	return Object.entries(dropped).map(([n, d]) => `Finding ${n}: origin ${d.claimed} dropped: ${d.reason}`);
}

#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// How often a finding's Origin matched where its fix landed. For each PR
// Outcomes row that was fixed, in the PR or later on main, by commits the row
// names: did those commits change lines the tested change wrote? If so the
// fix was in the change, which is what Introduced claims; if not, Exposed and
// Inherited were right to say it was not. Prints a markdown table.
//
//   node origin-accuracy.mjs rows.jsonl
//
// Run from a checkout with main's full history (the outcomes job has one).

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FIXED = new Set(['fixed-in-pr', 'fixed-later']);

/** The fix commits a fixed row's evidence names (`pr a1,b2: ...`, `main c3: ...`); none for another row. */
export function fixCommits(row) {
	if (!FIXED.has(row.outcome) || row.decidedBy !== 'diff+model') {
		return [];
	}
	const m = /^(?:pr(?: \(whole\))?|main) ([0-9a-f]{7,40}(?:,[0-9a-f]{7,40})*):/.exec(String(row.evidence ?? ''));
	return m ? m[1].split(',') : [];
}

/** Each file a commit changed, with the parent's line ranges it rewrote or deleted (a pure insertion has none). */
export function changedRanges(showU0) {
	const out = new Map();
	let file = null;
	for (const line of showU0.split('\n')) {
		const from = /^--- (?:a\/(.*)|\/dev\/null)$/.exec(line);
		if (from) {
			file = from[1] ?? null;
			continue;
		}
		const hunk = /^@@ -(\d+)(?:,(\d+))? /.exec(line);
		if (hunk && file && Number(hunk[2] ?? '1') > 0) {
			const start = Number(hunk[1]);
			out.set(file, [...(out.get(file) ?? []), [start, start + Number(hunk[2] ?? '1') - 1]]);
		}
	}
	return out;
}

/**
 * Whether the fix commits changed lines the tested change wrote: the PR's
 * commits up to the tested one, or the PR's squash commit on main.
 * Limited to the row's paths, when it has any, so an unrelated commit to
 * another file never counts. Null when git cannot say.
 */
export function fixInChange(git, row) {
	const commits = fixCommits(row);
	if (!commits.length || !row.testedSha) {
		return null;
	}
	let inChange;
	try {
		const base = git(['merge-base', row.testedSha, 'origin/main']).trim();
		inChange = new Set(git(['rev-list', `${base}..${row.testedSha}`]).split('\n').filter(Boolean));
		const squash = git(['log', 'origin/main', '-1', '--format=%H', '-F', `--grep=(#${row.pr})`]).trim();
		if (squash) {
			inChange.add(squash);
		}
	} catch {
		return null;
	}
	const paths = row.paths ?? [];
	for (const commit of commits) {
		let ranges;
		try {
			ranges = changedRanges(git(['show', '-U0', '--format=', '--no-color', commit, ...(paths.length ? ['--', ...paths] : [])]));
		} catch {
			continue;
		}
		for (const [file, spans] of ranges) {
			for (const [start, end] of spans) {
				try {
					const blame = git(['blame', '-w', '-M', '-C', '--porcelain', `${commit}^`, '-L', `${start},${end}`, '--', file]);
					if ([...blame.matchAll(/^([0-9a-f]{40}) \d+ \d+/gm)].some(m => inChange.has(m[1]))) {
						return true;
					}
				} catch {
					// A file the parent doesn't have, or lines it doesn't reach.
				}
			}
		}
	}
	return false;
}

/** Counts by the Origin claimed ('' for none) and whether the fix was in the change. */
export function tally(rows, judge) {
	const counts = {};
	for (const row of rows) {
		const inChange = judge(row);
		if (inChange === null) {
			continue;
		}
		const key = row.origin ?? '';
		counts[key] ??= { in: 0, out: 0 };
		counts[key][inChange ? 'in' : 'out']++;
	}
	return counts;
}

/** The markdown table: each Origin, how many fixes landed in and out of the change, and how many it got right. */
export function renderAccuracy(counts) {
	const right = { introduced: 'in', exposed: 'out', inherited: 'out' };
	const rows = ['introduced', 'exposed', 'inherited', ''].filter(o => counts[o]).map(o => {
		const c = counts[o];
		const total = c.in + c.out;
		const ok = right[o] ? `${c[right[o]]}/${total} (${Math.round(100 * c[right[o]] / total)}%)` : '-';
		return `| ${o ? o[0].toUpperCase() + o.slice(1) : 'None given'} | ${c.in} | ${c.out} | ${ok} |`;
	});
	if (!rows.length) {
		return '### Origin accuracy\n\nNo fixed finding names its fix commits yet.\n';
	}
	return ['### Origin accuracy', '', 'Findings fixed in the PR or later on main, by whether the fix changed lines the tested change wrote.', '',
		'| Origin | Fix in the change | Fix outside it | Right |', '|---|---|---|---|', ...rows, ''].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const [path] = process.argv.slice(2);
	if (!path) {
		console.error('usage: node origin-accuracy.mjs rows.jsonl');
		process.exit(2);
	}
	const rows = readFileSync(path, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => !r.dupOf);
	const git = args => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
	console.log(renderAccuracy(tally(rows, row => fixInChange(git, row))));
}

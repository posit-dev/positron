#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Build a context.json from the LOCAL git working tree, for the `pete-local`
// skill -- a pre-PR preview of what PETE will say. Pure `git`: no `gh`, no
// network, no auth. The classification, skip pre-filter, and context schema
// come from the shared `context-core.mjs`, so this and the CI gatherer produce
// identical output for the same diff.
//
// Working-tree mode: the diff is the current working tree (committed +
// uncommitted + untracked) against the merge-base with the default branch.
// Untracked files are included so a brand-new, not-yet-committed test file is
// counted -- that is exactly the kind of change PETE cares about.
//
// Usage: node gather-local-context.mjs <output-path>

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildContext, renderSkipComment } from './context-core.mjs';

const [, , outPath] = process.argv;
if (!outPath) {
	console.error('Usage: gather-local-context.mjs <output-path>');
	process.exit(2);
}

// Run git. `allowExit1` tolerates exit code 1, which `git diff --no-index`
// returns when files differ (the normal case) rather than as an error.
function git(args, { allowExit1 = false } = {}) {
	try {
		return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
	} catch (err) {
		if (allowExit1 && err.status === 1 && typeof err.stdout === 'string') {
			return err.stdout;
		}
		console.error(`git ${args.join(' ')} failed:`, err.message);
		process.exit(1);
	}
}

function gitQuiet(args) {
	try {
		execFileSync('git', args, { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
}

// --- Resolve the base ref the eventual PR would target ----------------------

function detectBaseRef() {
	// Prefer origin/HEAD (e.g. "origin/main") -- what the PR base will be.
	try {
		// Suppress stderr: when origin/HEAD isn't set, git prints a "not a
		// symbolic ref" fatal we handle by falling through to the candidates.
		const r = execFileSync('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
		if (r) { return r; }
	} catch {
		// origin/HEAD not set locally; fall through to candidates.
	}
	for (const cand of ['origin/main', 'origin/master', 'main', 'master']) {
		if (gitQuiet(['rev-parse', '--verify', '--quiet', cand])) { return cand; }
	}
	return 'main';
}

const baseRef = detectBaseRef();
const mergeBase = git(['merge-base', 'HEAD', baseRef]).trim();
const headRef = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
const author = (() => {
	try { return execFileSync('git', ['config', 'user.name'], { encoding: 'utf8' }).trim() || '?'; } catch { return '?'; }
})();

// Title/body: when the branch has its own commits beyond the base, derive them
// from the latest commit (the branch's work). When there are none, the latest
// commit is just the base tip and has nothing to do with the working-tree
// changes -- borrowing its subject would be misleading -- so use a clear
// placeholder instead. This is a local preview, not a real PR, so we don't
// accept overrides; this is enough to drive the skip pre-filter and give the
// grader context.
const commitsAhead = Number(git(['rev-list', '--count', `${baseRef}..HEAD`]).trim()) || 0;
const title = commitsAhead > 0
	? (git(['log', '-1', '--format=%s']).trim() || headRef)
	: `[local preview] uncommitted working-tree changes on ${headRef}`;
const body = commitsAhead > 0 ? git(['log', '-1', '--format=%b']).trim() : '';

// --- Collect the working-tree diff (tracked + untracked) --------------------

function countAddedLines(diffText) {
	let n = 0;
	for (const line of diffText.split('\n')) {
		if (line.startsWith('+') && !line.startsWith('+++')) { n++; }
	}
	return n;
}

// Tracked changes (staged + unstaged) vs the merge-base.
const trackedDiff = git(['diff', mergeBase]);
const numstat = git(['diff', '--numstat', mergeBase]);

const files = [];
let totalAdd = 0;
let totalDel = 0;

for (const line of numstat.split('\n')) {
	if (!line.trim()) { continue; }
	const parts = line.split('\t');
	if (parts.length < 3) { continue; }
	const [a, d] = parts;
	const path = parts.slice(2).join('\t');
	const additions = a === '-' ? 0 : Number(a) || 0;
	const deletions = d === '-' ? 0 : Number(d) || 0;
	files.push({ path, additions, deletions });
	totalAdd += additions;
	totalDel += deletions;
}

// Untracked files: synthesize an added-file diff for each via --no-index
// against /dev/null (git treats that literal specially on every OS).
const untracked = git(['ls-files', '--others', '--exclude-standard']).split('\n').map(s => s.trim()).filter(Boolean);
const untrackedDiffs = [];
for (const path of untracked) {
	const d = git(['diff', '--no-index', '--', '/dev/null', path], { allowExit1: true });
	if (!d) { continue; }
	const additions = countAddedLines(d);
	files.push({ path, additions, deletions: 0 });
	totalAdd += additions;
	untrackedDiffs.push(d);
}

const diff = [trackedDiff, ...untrackedDiffs].filter(Boolean).join('\n');

// --- Hand raw fields to the shared core -------------------------------------

const context = buildContext({
	pr: {
		number: null,
		title,
		body,
		author,
		url: '',
		baseRef,
		headRef,
	},
	additions: totalAdd,
	deletions: totalDel,
	files,
	diff,
});

writeFileSync(outPath, JSON.stringify(context, null, 2));

// When the pre-filter short-circuits, render the static skip verdict here (via
// the shared core) so the skill just presents it -- identical to what CI posts.
if (context.skip) {
	writeFileSync(join(dirname(outPath), 'comment.md'), renderSkipComment(context));
}

console.log(`[gather-local] base=${baseRef} head=${headRef} -- ${context.stats.fileCount} files, ${context.stats.testFileCount} test, ${context.stats.sourceFileCount} source, skip=${context.skip?.reason || 'no'}`);

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Every path a fixer touched must be inside the skill. Checked on the working
// tree after each session, and again on the patch before anything is pushed.
//
//   node .claude/skills/drive-positron/heal/scope.ts --worktree
//   node .claude/skills/drive-positron/heal/scope.ts --patch FILE...

import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { realpathSync } from 'fs';
import { resolve } from 'path';

export const SKILL_PREFIX = '.claude/skills/drive-positron/';

export function pathsFromStatus(porcelainZ: string): string[] {
	const parts = porcelainZ.split('\0');
	const out: string[] = [];
	for (let i = 0; i < parts.length; i++) {
		const e = parts[i];
		if (e.length < 4) { continue; }
		out.push(e.slice(3));
		// A rename or copy is followed by its source path as its own entry.
		if (/^[RC]/.test(e) || /^.[RC]/.test(e)) {
			if (i + 1 >= parts.length) { throw new Error('truncated status rename entry'); }
			out.push(parts[++i]);
		}
	}
	return out;
}

// `git apply --numstat -z` lists "added\tdeleted\tpath" per file, NUL-separated and unquoted.
// A rename or copy is "added\tdeleted\t" followed by the old and new paths as their own entries.
export function pathsFromNumstatZ(out: string): string[] {
	const parts = out.split('\0');
	if (parts[parts.length - 1] === '') { parts.pop(); }
	const paths: string[] = [];
	for (let i = 0; i < parts.length; i++) {
		const m = parts[i].match(/^(?:\d+|-)\t(?:\d+|-)\t([\s\S]*)$/);
		if (!m) { throw new Error(`unparseable numstat entry: ${JSON.stringify(parts[i])}`); }
		if (m[1] !== '') { paths.push(m[1]); continue; }
		if (i + 2 >= parts.length) { throw new Error('truncated numstat rename entry'); }
		paths.push(parts[i + 1], parts[i + 2]);
		i += 2;
	}
	return paths;
}

// Plain --numstat reports only the new name of a pure rename, so the source comes from
// `--summary -z`: "rename A => B (N%)" or git's brace form "rename pre/{A => B}/suf (N%)".
// A name may itself contain " => ", so every split of the arrow is taken (fail closed).
export function pathsFromSummaryZ(out: string): string[] {
	const paths: string[] = [];
	const bad = (line: string) => new Error(`unparseable summary line: ${JSON.stringify(line)}`);
	const splits = (s: string): Array<[string, string]> => {
		const names = s.split(' => ');
		const r: Array<[string, string]> = [];
		for (let k = 1; k < names.length; k++) { r.push([names.slice(0, k).join(' => '), names.slice(k).join(' => ')]); }
		return r;
	};
	for (const line of out.split('\n')) {
		if (!/^ (?:rename|copy) /.test(line)) { continue; }
		const m = line.match(/^ (?:rename|copy) ([\s\S]*) \(\d+%\)$/);
		if (!m) { throw bad(line); }
		const spec = m[1];
		if (!/[{}]/.test(spec)) {
			const s = splits(spec);
			if (!s.length) { throw bad(line); }
			for (const [x, y] of s) { paths.push(x, y); }
			continue;
		}
		const b = spec.match(/^([^{}]*)\{([^{}]*)\}([^{}]*)$/);
		if (!b) { throw bad(line); }
		const inner = splits(b[2]);
		if (!inner.length) { throw bad(line); }
		const join = (mid: string) => (b[1] + mid + b[3]).replace(/\/{2,}/g, '/');
		for (const [x, y] of inner) { paths.push(join(x), join(y)); }
	}
	return paths;
}

function git(args: string[], cwd: string): string {
	const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
	if (r.error || r.status !== 0) { throw new Error(`git ${args[0]} failed: ${r.error?.message || r.stderr}`); }
	return r.stdout;
}

export function repoRootOf(cwd: string): string {
	return git(['rev-parse', '--show-toplevel'], cwd).trim();
}

/** Paths a patch file touches, as git itself reads them. Throws on any failure or on a patch with no paths. */
export function pathsFromPatch(patchFile: string, repoRoot: string): string[] {
	const file = resolve(patchFile);
	const paths = [
		...pathsFromNumstatZ(git(['apply', '--numstat', '-z', file], repoRoot)),
		...pathsFromSummaryZ(git(['apply', '--summary', '-z', file], repoRoot)),
	];
	if (!paths.length) { throw new Error(`no paths found in ${patchFile}`); }
	return paths;
}

export function outside(paths: string[]): string[] {
	return paths.filter(p => !p.startsWith(SKILL_PREFIX) || p.includes('..') || /[\x00-\x1f]/.test(p));
}

function isMain(): boolean {
	try { return fileURLToPath(import.meta.url) === realpathSync(process.argv[1]); } catch { return false; }
}

function main(): number {
	const args = process.argv.slice(2);
	const repoRoot = repoRootOf(process.cwd());
	let paths: string[];
	if (args[0] === '--worktree') {
		paths = pathsFromStatus(git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], repoRoot));
	} else if (args[0] === '--patch' && args.length > 1) {
		paths = args.slice(1).flatMap(f => pathsFromPatch(f, repoRoot));
	} else {
		console.log('usage: scope.ts --worktree | --patch FILE...');
		return 2;
	}
	const bad = outside(paths);
	for (const p of bad) { console.log(`outside ${SKILL_PREFIX}: ${p}`); }
	return bad.length ? 1 : 0;
}

if (isMain()) {
	try {
		process.exitCode = main();
	} catch (e) {
		console.log(`scope: ${e instanceof Error ? e.message : String(e)}`);
		process.exitCode = 1;
	}
}

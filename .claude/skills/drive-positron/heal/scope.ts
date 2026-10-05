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
import { readFileSync } from 'fs';

export const SKILL_PREFIX = '.claude/skills/drive-positron/';

export function pathsFromStatus(porcelainZ: string): string[] {
	const parts = porcelainZ.split('\0');
	const out: string[] = [];
	for (let i = 0; i < parts.length; i++) {
		const e = parts[i];
		if (e.length < 4) { continue; }
		out.push(e.slice(3));
		// A rename or copy is followed by its source path as its own entry.
		if (/^[RC]/.test(e) || /^.[RC]/.test(e)) { out.push(parts[++i]); }
	}
	return out;
}

export function pathsFromPatch(patch: string): string[] {
	const out = new Set<string>();
	let inHeader = false;
	for (const line of patch.split('\n')) {
		const d = line.match(/^diff --git a\/(.+) b\/(.+)$/);
		if (d) { out.add(d[1]); out.add(d[2]); inHeader = true; continue; }
		if (line.startsWith('@@')) { inHeader = false; continue; }
		if (!inHeader) { continue; }
		const m = line.match(/^(?:rename from|rename to|copy from|copy to) (.+)$/) ?? line.match(/^(?:---|\+\+\+) [ab]\/(.+)$/);
		if (m) { out.add(m[1]); }
	}
	return [...out];
}

export function outside(paths: string[]): string[] {
	return paths.filter(p => !p.startsWith(SKILL_PREFIX));
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const args = process.argv.slice(2);
	let paths: string[];
	if (args[0] === '--worktree') {
		const s = spawnSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { encoding: 'utf8' });
		paths = pathsFromStatus(s.stdout);
	} else if (args[0] === '--patch') {
		paths = args.slice(1).flatMap(f => pathsFromPatch(readFileSync(f, 'utf8')));
	} else {
		console.log('usage: scope.ts --worktree | --patch FILE...');
		process.exit(2);
	}
	const bad = outside(paths);
	for (const p of bad) { console.log(`outside ${SKILL_PREFIX}: ${p}`); }
	process.exitCode = bad.length ? 1 : 0;
}

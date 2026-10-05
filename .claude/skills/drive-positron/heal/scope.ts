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
import { fileURLToPath } from 'url';
import { realpathSync } from 'fs';

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

function decodeGitPath(s: string): string {
	// Unquote and decode C-style escapes from git diff paths
	if (s.startsWith('"') && s.endsWith('"')) {
		s = s.slice(1, -1);
		// Decode octal \NNN as UTF-8 bytes, plus \t, \n, \", \\
		let out = '';
		for (let i = 0; i < s.length; i++) {
			if (s[i] === '\\' && i + 1 < s.length) {
				const c = s[i + 1];
				if (c === 't') { out += '\t'; i++; }
				else if (c === 'n') { out += '\n'; i++; }
				else if (c === '"') { out += '"'; i++; }
				else if (c === '\\') { out += '\\'; i++; }
				else if (c >= '0' && c <= '7' && i + 3 < s.length && s[i + 2] >= '0' && s[i + 2] <= '7' && s[i + 3] >= '0' && s[i + 3] <= '7') {
					// Octal escape: collect up to 3 digits
					const octal = s.slice(i + 1, i + 4);
					const byte = parseInt(octal, 8);
					out += String.fromCharCode(byte);
					i += 3;
				} else {
					out += s[i];
				}
			} else {
				out += s[i];
			}
		}
		return out;
	}
	return s;
}

export function pathsFromPatch(patch: string): string[] {
	const out = new Set<string>();
	let inHeader = false;
	for (const line of patch.split('\n')) {
		let d = line.match(/^diff --git "a\/(.*)" "b\/(.*)"\s*$/);
		if (!d) { d = line.match(/^diff --git a\/(.*) b\/(.*)$/); }
		if (d) {
			const aPath = decodeGitPath(d[1]);
			const bPath = decodeGitPath(d[2]);
			if (!aPath || !bPath) { throw new Error(`Invalid diff --git line: ${line}`); }
			out.add(aPath);
			out.add(bPath);
			inHeader = true;
			continue;
		}
		if (line.startsWith('@@')) { inHeader = false; continue; }
		if (!inHeader) { continue; }
		const m = line.match(/^(?:rename from|rename to|copy from|copy to) (.+)$/) ?? line.match(/^(?:---|\+\+\+) [ab]\/(.*)$/);
		if (m) { out.add(decodeGitPath(m[1])); }
	}
	return [...out];
}

export function outside(paths: string[]): string[] {
	return paths.filter(p => !p.startsWith(SKILL_PREFIX) || p.includes('..'));
}

try {
	if (fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
		const args = process.argv.slice(2);
		let paths: string[];
		if (args[0] === '--worktree') {
			const s = spawnSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { encoding: 'utf8' });
			if (s.error || s.status !== 0) {
				console.log(`scope: git failed: ${s.error?.message || s.stderr}`);
				process.exit(1);
			}
			paths = pathsFromStatus(s.stdout);
		} else if (args[0] === '--patch') {
			const files = args.slice(1);
			if (!files.length) {
				console.log('usage: scope.ts --worktree | --patch FILE...');
				process.exit(1);
			}
			try {
				paths = files.flatMap(f => pathsFromPatch(readFileSync(f, 'utf8')));
			} catch (e) {
				console.log(`scope: ${e instanceof Error ? e.message : String(e)}`);
				process.exit(1);
			}
			if (!paths.length) {
				console.log('scope: no paths found in patch');
				process.exit(1);
			}
		} else {
			console.log('usage: scope.ts --worktree | --patch FILE...');
			process.exit(2);
		}
		const bad = outside(paths);
		for (const p of bad) { console.log(`outside ${SKILL_PREFIX}: ${p}`); }
		process.exitCode = bad.length ? 1 : 0;
	}
} catch {
	// Not running as CLI script, likely imported as module
}

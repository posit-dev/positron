/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

//   node .claude/skills/drive-positron/heal/links.ts candidate --run-id ID
//   node .claude/skills/drive-positron/heal/links.ts compare --branch B --title T --body-file F --run-url U
//   node .claude/skills/drive-positron/heal/links.ts stale --branches FILE --open FILE
//
// Usage errors exit 2, anything else that fails exits 1.

import { readFileSync, realpathSync } from 'fs';
import { fileURLToPath } from 'url';
import { flagValue, unknownArg } from '../test/smoke-lib.ts';
import { SKILL_PREFIX } from './scope.ts';

const REPO = 'https://github.com/posit-dev/positron';

export function candidateBranch(date: Date, runId: string): string {
	return `automated/drive-positron/${date.toISOString().slice(0, 10)}-${runId}`;
}

/** A compare page with the PR form open and filled in. The body is cut to fit `max` and always ends with the run link. */
export function compareUrl(branch: string, title: string, body: string, runUrl: string, max = 8000): string {
	const tail = `\n\nFull run: ${runUrl}`;
	const build = (b: string) => `${REPO}/compare/main...${branch}?expand=1&title=${encodeURIComponent(title)}&body=${encodeURIComponent(b + tail)}`;
	if (build(body).length <= max) { return build(body); }
	// Search on plain indices; the probe and the final cut both step back off a split surrogate
	// pair, since encodeURIComponent throws on a lone surrogate.
	const snap = (n: number) => {
		const c = body.charCodeAt(n - 1);
		return n > 0 && c >= 0xD800 && c <= 0xDBFF ? n - 1 : n;
	};
	let lo = 0, hi = body.length;
	while (lo < hi) {
		const mid = Math.ceil((lo + hi) / 2);
		if (build(`${body.slice(0, snap(mid))}\n\n(trimmed)`).length <= max) { lo = mid; } else { hi = mid - 1; }
	}
	lo = snap(lo);
	return build(`${body.slice(0, lo)}\n\n(trimmed)`);
}

export function staleBranches(branches: string[], openHeads: string[], now: Date, days = 14): string[] {
	const cutoff = now.getTime() - days * 86400000;
	return branches.filter(b => {
		const d = b.match(/^automated\/drive-positron\/(\d{4}-\d{2}-\d{2})-/)?.[1];
		return d !== undefined && Date.parse(`${d}T00:00:00Z`) < cutoff && !openHeads.includes(b);
	});
}

export function smokeChecksChanged(paths: string[]): boolean {
	return paths.includes(`${SKILL_PREFIX}test/smoke.ts`);
}

const VERBS: Record<string, string[]> = {
	candidate: ['--run-id'],
	compare: ['--branch', '--title', '--body-file', '--run-url'],
	stale: ['--branches', '--open'],
};

const lines = (file: string) => readFileSync(file, 'utf8').split('\n').filter(Boolean);

/** Runs one verb; `code` 2 is a usage error and `out` is what to print. Throws on an unreadable file. */
export function cli(argv: string[], now = new Date()): { code: number; out: string } {
	const verb = argv[0];
	const usage = (why: string) => ({ code: 2, out: `links: ${why}\nusage: links.ts candidate|compare|stale (see the header for flags)` });
	if (verb === undefined || !(verb in VERBS)) { return usage(`unknown verb ${JSON.stringify(verb ?? '')}`); }
	const bad = unknownArg(argv, VERBS[verb], Object.keys(VERBS));
	if (bad !== null) { return usage(`unexpected argument ${JSON.stringify(bad)}`); }
	const v: Record<string, string> = {};
	for (const name of VERBS[verb]) {
		const val = flagValue(argv, name);
		if (val instanceof Error) { return usage(val.message); }
		if (val === null) { return usage(`${name} is required`); }
		v[name] = val;
	}
	if (verb === 'candidate') { return { code: 0, out: candidateBranch(now, v['--run-id']) }; }
	if (verb === 'compare') { return { code: 0, out: compareUrl(v['--branch'], v['--title'], readFileSync(v['--body-file'], 'utf8'), v['--run-url']) }; }
	return { code: 0, out: staleBranches(lines(v['--branches']), lines(v['--open']), now).join('\n') };
}

function isMain(): boolean {
	try { return fileURLToPath(import.meta.url) === realpathSync(process.argv[1]); } catch { return false; }
}

if (isMain()) {
	try {
		const r = cli(process.argv.slice(2));
		if (r.out !== '') { console.log(r.out); }
		process.exitCode = r.code;
	} catch (e) {
		console.log(`links: ${e instanceof Error ? e.message : String(e)}`);
		process.exitCode = 1;
	}
}

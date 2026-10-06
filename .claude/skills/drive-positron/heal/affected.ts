/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Which smoke sections a fix can change, so the post-fix check reruns only
// those. A changed .sh or dp-<area>.ts reaches the helpers that run it,
// through the modules that import it and the scripts that call it. Anything
// shared (dp.ts, dp-lib.ts, page-lib.ts, selectors.ts, test/) means all.

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { SmokeResults } from '../test/smoke-lib.ts';
import { SKILL_PREFIX } from './scope.ts';

export interface ScriptGraph {
	/** dp.ts command -> the dp-<area>.ts that registers it. */
	moduleOf: Map<string, string>;
	/** dp-<area>.ts -> the dp-<area>.ts files it imports. */
	imports: Map<string, string[]>;
	/** X.sh -> the dp.ts commands it runs. */
	commands: Map<string, string[]>;
	/** X.sh -> the .sh scripts it calls. */
	calls: Map<string, string[]>;
}

export function readGraph(scripts: string): ScriptGraph {
	const g: ScriptGraph = { moduleOf: new Map(), imports: new Map(), commands: new Map(), calls: new Map() };
	for (const f of readdirSync(scripts)) {
		const text = readFileSync(join(scripts, f), 'utf8');
		if (/^dp-[a-z-]+\.ts$/.test(f) && f !== 'dp-lib.ts') {
			g.imports.set(f, [...text.matchAll(/from '\.\/(dp-[a-z-]+\.ts)'/g)].map(m => m[1]).filter(m => m !== 'dp-lib.ts'));
			const block = text.match(/export const \w+Commands\b[^\n]* = \{\n([\s\S]*?)\n\};/)?.[1] ?? '';
			for (const m of block.matchAll(/^\t'?([a-z][a-z-]*)'?: /gm)) { g.moduleOf.set(m[1], f); }
		} else if (f.endsWith('.sh')) {
			g.commands.set(f, [...text.matchAll(/dp\.ts" ([a-z][a-z-]*)/g)].map(m => m[1]));
			g.calls.set(f, [...text.matchAll(/\$DIR\/([a-z-]+\.sh)/g)].map(m => m[1]).filter(c => c !== f));
		}
	}
	return g;
}

/** The helpers (X.sh) a change to these repo-relative paths can reach, or 'all'. */
export function affectedHelpers(paths: string[], g: ScriptGraph): Set<string> | 'all' {
	const modules = new Set<string>();
	const helpers = new Set<string>();
	for (const p of paths) {
		const rel = p.startsWith(SKILL_PREFIX) ? p.slice(SKILL_PREFIX.length) : null;
		if (rel === null) { return 'all'; }
		if (rel.endsWith('.md') || rel.startsWith('heal/')) { continue; }
		const sh = rel.match(/^scripts\/([a-z-]+\.sh)$/)?.[1];
		const mod = rel.match(/^scripts\/(dp-[a-z-]+\.ts)$/)?.[1];
		if (sh && g.commands.has(sh)) { helpers.add(sh); }
		else if (mod && g.imports.has(mod)) { modules.add(mod); }
		else { return 'all'; }
	}
	for (let grew = true; grew;) {
		grew = false;
		for (const [m, deps] of g.imports) {
			if (!modules.has(m) && deps.some(d => modules.has(d))) { modules.add(m); grew = true; }
		}
	}
	for (const [sh, cmds] of g.commands) {
		if (cmds.some(c => modules.has(g.moduleOf.get(c) ?? ''))) { helpers.add(sh); }
	}
	for (let grew = true; grew;) {
		grew = false;
		for (const [sh, called] of g.calls) {
			if (!helpers.has(sh) && called.some(c => helpers.has(c))) { helpers.add(sh); grew = true; }
		}
	}
	return helpers;
}

/**
 * The sections to rerun after a fix, in run order, each with its last case
 * (for `smoke.ts --until`); null for a full run. The fix's own case's section
 * is always in. A full run when the change is shared, the baseline has no
 * sections, or one launch per section (`launchMs` each, for the launch and
 * the setup) would take as long as the full run by the baseline's timings.
 */
export function postSections(baseline: SmokeResults, helpers: Set<string> | 'all', own: { case?: string; helper: string }, launchMs = 60_000): { id: string; last: string }[] | null {
	if (helpers === 'all' || baseline.cases.some(c => !c.group)) { return null; }
	const want = new Set([...helpers, own.helper]);
	const last = new Map<string, string>();
	const picked = new Set<string>();
	for (const c of baseline.cases) {
		last.set(c.group!, c.name);
		if (want.has(c.helper) || c.name === own.case) { picked.add(c.group!); }
	}
	const ms = (keep: (g: string) => boolean) => baseline.cases.filter(c => keep(c.group!)).reduce((t, c) => t + c.ms, 0);
	if (!picked.size || ms(g => picked.has(g)) + picked.size * launchMs >= ms(() => true) + launchMs) { return null; }
	return [...last].filter(([id]) => picked.has(id)).map(([id, name]) => ({ id, last: name }));
}

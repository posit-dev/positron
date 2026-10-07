/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CaseResult, SmokeResults } from '../test/smoke-lib.ts';
import type { Finding, Reproduction } from './finding.ts';

/** The report's plain-language account, one sentence each; a session may leave any of them out. */
export type Plain = { broke?: string; cause?: string; change?: string };
/** `plain` holds only the fields the session wrote; the outcome file has them at the top level. */
export type FixerOutcome = { outcome: 'fixed' | 'product' | 'flake'; reason: string; reproduction: Reproduction; plain: Plain };

export function queue(findings: Finding[], smokeOrder: string[], cap = 5): { attempt: Finding[]; notAttempted: Finding[] } {
	const at = (f: Finding) => f.source === 'smoke' ? smokeOrder.indexOf(f.case ?? '') : smokeOrder.length;
	const open = findings.filter(f => f.outcome === undefined).sort((a, b) => at(a) - at(b) || a.id.localeCompare(b.id));
	return { attempt: open.slice(0, cap), notAttempted: open.slice(cap) };
}

/** Cases that passed before a fix and do not pass after it. */
export function regressions(before: SmokeResults, after: SmokeResults): CaseResult[] {
	const now = new Map(after.cases.map(c => [c.name, c]));
	return before.cases.filter(c => c.status === 'PASS').flatMap(c => {
		const a = now.get(c.name);
		if (!a) { return [{ ...c, status: 'FAIL' as const, problem: 'not reached' }]; }
		return a.status === 'PASS' ? [] : [a];
	});
}

/** Only the cases in these sections; a post-fix run of some sections is compared on those alone. */
export function inSections(r: SmokeResults, ids: string[]): SmokeResults {
	return { ...r, cases: r.cases.filter(c => c.group !== undefined && ids.includes(c.group)) };
}

/** The baseline with `after`'s results in place of its own, for a run that covered only some sections. */
export function replaceCases(baseline: SmokeResults, after: SmokeResults): SmokeResults {
	const now = new Map(after.cases.map(c => [c.name, c]));
	return { ...baseline, cases: baseline.cases.map(c => now.get(c.name) ?? c) };
}

export function readOutcome(text: string | null): FixerOutcome | string {
	if (text === null) { return 'the fixer wrote no outcome file'; }
	let o: (Partial<Omit<FixerOutcome, 'plain'>> & Partial<Record<keyof Plain, unknown>>) | null;
	try { o = JSON.parse(text); } catch { return `the outcome file is not JSON: ${text.slice(0, 120)}`; }
	if (!o || typeof o !== 'object') { return `the outcome file is not a JSON object: ${text.slice(0, 120)}`; }
	if (!['fixed', 'product', 'flake'].includes(o.outcome as string)) { return `outcome "${o.outcome}" is not fixed, product or flake`; }
	if (typeof o.reason !== 'string' || !o.reason.trim()) { return 'the outcome has no reason'; }
	const r = o.reproduction;
	if (!r || typeof r.observed !== 'string' || (r.result !== 'fail' && r.result !== 'pass')) { return 'the outcome has no reproduction'; }
	const plain: Plain = {};
	for (const k of ['broke', 'cause', 'change'] as const) {
		const v = o[k];
		if (typeof v === 'string' && v.trim()) { plain[k] = v.trim(); }
	}
	return { outcome: o.outcome as FixerOutcome['outcome'], reason: o.reason, reproduction: { ...r, by: 'fixer' } as Reproduction, plain };
}

/** The latest verdicts on finding `id` from earlier nights, newest first; `runs` maps run id to that night's findings. */
export function earlierVerdicts(runs: Map<string, Finding[]>, id: string, max = 3): string[] {
	return [...runs].sort(([a], [b]) => Number(b) - Number(a))
		.flatMap(([run, fs]) => fs.filter(f => f.id === id && f.outcome && f.outcome !== 'resolved').map(f => `run ${run}: ${f.outcome}${f.rejected ? ` (rejected: ${f.rejected})` : ''}: ${f.reason ?? ''}`))
		.slice(0, max);
}

/** The earlier runs, newest first, that fixed finding `id` and kept the fix. */
export function fixedBefore(runs: Map<string, Finding[]>, id: string): string[] {
	return [...runs].filter(([, fs]) => fs.some(f => f.id === id && f.outcome === 'fixed' && f.commit && !f.rejected))
		.map(([run]) => run).sort((a, b) => Number(b) - Number(a));
}

/** check.ts's verdict per check, from the `PASS|FAIL <name>` line it prints for each. */
export function parseChecks(out: string): Map<string, 'PASS' | 'FAIL'> {
	return new Map([...out.matchAll(/^(PASS|FAIL) (\S+)/gm)].map(m => [m[2], m[1] as 'PASS' | 'FAIL']));
}

/** The checks a fix turned red: failing now but not before, or passing before and gone now. */
export function newCheckFailures(before: Map<string, 'PASS' | 'FAIL'>, after: Map<string, 'PASS' | 'FAIL'>): string[] {
	const failing = [...after].filter(([name, v]) => v === 'FAIL' && before.get(name) !== 'FAIL').map(([name]) => name);
	const gone = [...before].filter(([name, v]) => v === 'PASS' && !after.has(name)).map(([name]) => name);
	return [...failing, ...gone];
}

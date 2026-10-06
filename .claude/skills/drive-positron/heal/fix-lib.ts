/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CaseResult, SmokeResults } from '../test/smoke-lib.ts';
import type { Finding, Reproduction } from './finding.ts';

export type FixerOutcome = { outcome: 'fixed' | 'product' | 'flake'; reason: string; reproduction: Reproduction };

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
	let o: Partial<FixerOutcome> | null;
	try { o = JSON.parse(text); } catch { return `the outcome file is not JSON: ${text.slice(0, 120)}`; }
	if (!o || typeof o !== 'object') { return `the outcome file is not a JSON object: ${text.slice(0, 120)}`; }
	if (!['fixed', 'product', 'flake'].includes(o.outcome as string)) { return `outcome "${o.outcome}" is not fixed, product or flake`; }
	if (typeof o.reason !== 'string' || !o.reason.trim()) { return 'the outcome has no reason'; }
	const r = o.reproduction;
	if (!r || typeof r.observed !== 'string' || (r.result !== 'fail' && r.result !== 'pass')) { return 'the outcome has no reproduction'; }
	return { outcome: o.outcome as FixerOutcome['outcome'], reason: o.reason, reproduction: { ...r, by: 'fixer' } as Reproduction };
}

/** The latest verdicts on finding `id` from earlier nights, newest first; `runs` maps run id to that night's findings. */
export function earlierVerdicts(runs: Map<string, Finding[]>, id: string, max = 3): string[] {
	return [...runs].sort(([a], [b]) => Number(b) - Number(a))
		.flatMap(([run, fs]) => fs.filter(f => f.id === id && f.outcome && f.outcome !== 'resolved').map(f => `run ${run}: ${f.outcome}${f.rejected ? ` (rejected: ${f.rejected})` : ''}: ${f.reason ?? ''}`))
		.slice(0, max);
}

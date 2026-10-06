/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CaseResult, SmokeResults } from '../test/smoke-lib.ts';
import { addFields, slug, type Finding } from './finding.ts';

export interface Classified {
	persistent: { first: CaseResult; second: CaseResult }[];
	flakes: { name: string; first: CaseResult; second: CaseResult }[];
	unconfirmed: { name: string; first: CaseResult }[];
}

/** The last FAIL in each group, in run order; results without groups count as one group. */
export function lastFailedPerGroup(r: SmokeResults): string[] {
	const last = new Map<string, string>();
	for (const c of r.cases.filter(x => x.status === 'FAIL')) { last.delete(c.group ?? ''); last.set(c.group ?? '', c.name); }
	return [...last.values()];
}

/** Several runs' results as one: every case, launched only if every run launched. */
export function mergeResults(runs: SmokeResults[]): SmokeResults {
	const failed = runs.find(r => r.launch === 'FAIL');
	return { ...runs[0], launch: failed ? 'FAIL' : 'PASS', launchProblem: failed?.launchProblem ?? '', cases: runs.flatMap(r => r.cases) };
}

export function classify(first: SmokeResults, second: SmokeResults): Classified {
	const out: Classified = { persistent: [], flakes: [], unconfirmed: [] };
	const again = new Map(second.cases.map(c => [c.name, c]));
	for (const f of first.cases.filter(c => c.status === 'FAIL')) {
		const s = again.get(f.name);
		if (!s) { out.unconfirmed.push({ name: f.name, first: f }); }
		else if (s.status === 'FAIL') { out.persistent.push({ first: f, second: s }); }
		else { out.flakes.push({ name: f.name, first: f, second: s }); }
	}
	return out;
}

export function smokeFinding(first: CaseResult, second: CaseResult, at: { first: string; second: string }): Finding {
	return {
		id: `smoke-${slug(first.name)}`, source: 'smoke', case: first.name, helper: first.helper,
		steps: [`node .claude/skills/drive-positron/test/smoke.ts --until "${first.name}"`, [first.helper, ...first.args].join(' ')],
		observed: first.problem, expected: `smoke case "${first.name}" passes`,
		reproductions: [
			{ at: at.first, by: 'smoke', result: 'fail', observed: first.problem },
			{ at: at.second, by: 'rerun', result: 'fail', observed: second.problem },
		],
	};
}

/** More than a quarter of the cases failing twice is the environment, not the helpers. */
export function wholesale(findings: number, cases: number, threshold = 0.25): boolean {
	return cases > 0 && findings / cases > threshold;
}

export function cascade(findings: Finding[], after: SmokeResults, fixedId: string, at: string): Finding[] {
	const passed = new Set(after.cases.filter(c => c.status === 'PASS').map(c => c.name));
	return findings.map(f => f.source === 'smoke' && f.outcome === undefined && f.id !== fixedId && f.case && passed.has(f.case)
		? addFields(f, { outcome: 'resolved', resolvedBy: fixedId, reproductions: [{ at, by: 'rerun', result: 'pass', observed: `passed after ${fixedId}` }] })
		: f);
}

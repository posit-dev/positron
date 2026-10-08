/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// One JSON file per finding. Fields are only ever added: a later stage never
// rewrites what an earlier one recorded.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { isDeepStrictEqual } from 'util';
import { join } from 'path';

export type Outcome = 'fixed' | 'product' | 'flake' | 'resolved';
export interface Reproduction { at: string; by: 'smoke' | 'rerun' | 'finder' | 'fixer'; result: 'fail' | 'pass'; observed: string }
export interface Finding {
	id: string; source: 'smoke' | 'finder'; case?: string; helper: string; steps: string[];
	observed: string; expected: string; reproductions: Reproduction[];
	outcome?: Outcome; reason?: string; resolvedBy?: string; checksChanged?: boolean;
	commit?: string; rejected?: string; notAttempted?: string;
	/** The smoke sections the post-fix check reran; absent when it ran the full suite. */
	smokeSections?: string[];
	/** The fixer's plain-language account, one sentence each: what broke, why, and what the fix changes. */
	broke?: string; cause?: string; change?: string;
	/** The fixer's account of a check it changed under test/ or heal/: which, what it asserted, and why. */
	checks?: string;
	/** Earlier runs that fixed this finding too; it came back, so those fixes never landed. */
	fixedBefore?: string[];
	/** The smoke cases a kept fix added. */
	newCases?: string[];
	/** Why a fix that changes a helper has no smoke case, in the fixer's words. */
	untestable?: string;
	/** The reviewer's notes on the kept change; a second review's, when the fix was sent back once. */
	review?: string[];
	/** The fixer revised its change once after a review. */
	revised?: boolean;
	/** The last review's verdict on the kept change; a revise was recorded, not obeyed. */
	reviewVerdict?: 'approve' | 'revise';
	/** The helpers the kept change can reach, or 'all'. */
	reaches?: string[] | 'all';
}

const OUTCOMES = ['fixed', 'product', 'flake', 'resolved'];

export function slug(s: string): string {
	return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function validateFinding(x: unknown): string[] {
	const f = x as Partial<Finding> | null;
	if (!f || typeof f !== 'object') { return ['not an object']; }
	const p: string[] = [];
	const str = (k: keyof Finding) => { if (typeof f[k] !== 'string' || !(f[k] as string).trim()) { p.push(`${k}: missing or empty`); } };
	(['id', 'helper', 'observed', 'expected'] as const).forEach(str);
	if (f.id && !/^[a-z0-9-]+$/.test(f.id)) { p.push(`id: "${f.id}" is not lowercase-dashed`); }
	if (f.source !== 'smoke' && f.source !== 'finder') { p.push(`source: "${f.source}" is not smoke or finder`); }
	if (f.source === 'smoke' && !f.case) { p.push('case: a smoke finding names its case'); }
	if (!Array.isArray(f.steps) || !f.steps.length) { p.push('steps: none'); }
	if (!Array.isArray(f.reproductions) || !f.reproductions.length) { p.push('reproductions: none'); }
	else if (f.reproductions.filter(r => r?.result === 'fail').length < 2) { p.push('reproductions: needs two failing reproductions'); }
	if (f.outcome !== undefined && !OUTCOMES.includes(f.outcome)) { p.push(`outcome: "${f.outcome}" is not one of ${OUTCOMES.join(', ')}`); }
	if (f.outcome === 'resolved' && !f.resolvedBy) { p.push('resolvedBy: a resolved finding names what resolved it'); }
	return p;
}

/** The finding with patch's fields added; reproductions are appended. Throws on a change to a field already set. */
export function addFields(f: Finding, patch: Partial<Finding>): Finding {
	const out: Finding = { ...f, reproductions: [...f.reproductions] };
	for (const [k, v] of Object.entries(patch) as [keyof Finding, unknown][]) {
		if (k === 'reproductions') { out.reproductions.push(...(v as Reproduction[])); continue; }
		if (f[k] !== undefined && !isDeepStrictEqual(f[k], v)) { throw new Error(`finding ${f.id} is append-only: ${k} is already ${JSON.stringify(f[k])}`); }
		(out as unknown as Record<string, unknown>)[k] = v;
	}
	return out;
}

export function readFindings(dir: string): Finding[] {
	if (!existsSync(dir)) { return []; }
	return readdirSync(dir).filter(n => n.endsWith('.json')).sort()
		.map(n => JSON.parse(readFileSync(join(dir, n), 'utf8')) as Finding);
}

export function writeFinding(dir: string, f: Finding): void {
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, `${f.id}.json`), `${JSON.stringify(f, null, '\t')}\n`);
}

export interface State {
	wholesale?: boolean; scopeViolation?: string; gate?: 'pass' | 'fail' | 'none'; notAttempted?: string[];
	/** The check.ts checks that failed before any fix; a fix is judged on the others. */
	checksRedOnMain?: string[];
	/** Findings left without a session because the night's fixer budget ran out. */
	outOfTime?: number;
}
export function readState(dir: string): State {
	const file = join(dir, 'state.json');
	return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as State : {};
}
export function writeState(dir: string, patch: State): void {
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'state.json'), `${JSON.stringify({ ...readState(dir), ...patch }, null, '\t')}\n`);
}
